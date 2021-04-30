mdc.ripple.MDCRipple.attachTo(document.querySelector('.mdc-button'));

const configuration = {
  iceServers: [
    {
      urls: [
        'stun:stun1.l.google.com:19302',
        'stun:stun2.l.google.com:19302',
      ],
    },
  ],
  iceCandidatePoolSize: 10,
};

let peerConnection = null;
let localStream = null;
let remoteStream = null;
let roomDialog = null;
let roomId = null;

function init() {
  document.querySelector('#cameraBtn').addEventListener('click', openUserMedia);
  document.querySelector('#hangupBtn').addEventListener('click', hangUp);
  document.querySelector('#createBtn').addEventListener('click', createRoom);
  document.querySelector('#joinBtn').addEventListener('click', joinRoom);
  roomDialog = new mdc.dialog.MDCDialog(document.querySelector('#room-dialog'));
}

let role;
async function createRoom() {
  document.querySelector('#createBtn').disabled = true;
  document.querySelector('#joinBtn').disabled = true;
  const db = firebase.firestore();
  const roomRef = await db.collection('rooms').doc();

  console.log('Create PeerConnection with configuration: ', configuration);
  peerConnection = new RTCPeerConnection(configuration);

  registerPeerConnectionListeners();

  localStream.getTracks().forEach(track => {
    peerConnection.addTrack(track, localStream);
  });

  // Code for collecting ICE candidates below
  const callerCandidatesCollection = roomRef.collection('callerCandidates');

  peerConnection.addEventListener('icecandidate', event => {
    if (!event.candidate) {
      console.log('Got final candidate!');
      return;
    }
    console.log('Got candidate: ', event.candidate);
    callerCandidatesCollection.add(event.candidate.toJSON());
  });
  // Code for collecting ICE candidates above

  // Code for creating a room below
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  console.log('Created offer:', offer);

  const roomWithOffer = {
    'offer': {
      type: offer.type,
      sdp: offer.sdp,
    },
  };
  await roomRef.set(roomWithOffer);
  roomId = roomRef.id;
  console.log(`New room created with SDP offer. Room ID: ${roomRef.id}`);
  document.querySelector(
      '#currentRoom').innerText = `Current room is ${roomRef.id} - You are the caller!`;
  // Code for creating a room above

  peerConnection.addEventListener('track', event => {
    console.log('Got remote track:', event.streams[0]);
    event.streams[0].getTracks().forEach(track => {
      console.log('Add a track to the remoteStream:', track);
      remoteStream.addTrack(track);
    });
  });

  // Listening for remote session description below
  roomRef.onSnapshot(async snapshot => {
    const data = snapshot.data();
    if (!peerConnection.currentRemoteDescription && data && data.answer) {
      console.log('Got remote description: ', data.answer);
      const rtcSessionDescription = new RTCSessionDescription(data.answer);
      await peerConnection.setRemoteDescription(rtcSessionDescription);
    }
  });
  // Listening for remote session description above

  // Listen for remote ICE candidates below
  roomRef.collection('calleeCandidates').onSnapshot(snapshot => {
    snapshot.docChanges().forEach(async change => {
      if (change.type === 'added') {
        let data = change.doc.data();
        console.log(`Got new remote ICE candidate: ${JSON.stringify(data)}`);
        await peerConnection.addIceCandidate(new RTCIceCandidate(data));
      }
    });
  });
  // Listen for remote ICE candidates above

  const usersInfo = roomRef.collection('userInfo');
  const remoteNameDOM = document.getElementById('remoteNameDOM');
  role = "creator";
  usersInfo.doc('creator').set({
    creatorName: localName,
  })
  if (roomId != null){
    const db = firebase.firestore();
    const userInfoRef = db.collection('rooms').doc(roomId).collection('userInfo');
    const remoteNameDOM = document.getElementById('remoteName');
    const chatNameDOM = document.getElementById('title');
    userInfoRef.onSnapshot(snapshot => {
      snapshot.docChanges().forEach(async change => {
        if (change.type == 'added'){
          if (change.doc.id == 'joiner'){
            let data = change.doc.data().joinerName;
            remoteNameDOM.innerHTML = `${data} (Other)`;
            chatNameDOM.innerHTML = `Chatting with ${data}`;
          }
        }
      })
    })
    
  }

  // Message Updater
  if (roomId != null){
    const db = firebase.firestore();
    const chatsRef = await db.collection('rooms').doc(roomId).collection('messages');
    const query = chatsRef.orderBy('createdAt');
    chatsRef.onSnapshot(snapshot => {
      snapshot.docChanges().forEach(async change => {
        if (change.type === 'added'){
          let data = change.doc.data();
          if (data.userID != localID){
            send_Message(data.message, "left", data.userPhoto);
          }
        }
      })
    })
  }
}

function joinRoom() {
  document.querySelector('#createBtn').disabled = true;
  document.querySelector('#joinBtn').disabled = true;

  document.querySelector('#confirmJoinBtn').
      addEventListener('click', async () => {
        roomId = document.querySelector('#room-id').value;
        console.log('Join room: ', roomId);
        document.querySelector(
            '#currentRoom').innerText = `Current room is ${roomId} - You are the callee!`;
        await joinRoomById(roomId);
      }, {once: true});
  roomDialog.open();
}

async function joinRoomById(roomId) {
  const db = firebase.firestore();
  const roomRef = db.collection('rooms').doc(`${roomId}`);
  const roomSnapshot = await roomRef.get();
  console.log('Got room:', roomSnapshot.exists);

  if (roomSnapshot.exists) {
    console.log('Create PeerConnection with configuration: ', configuration);
    peerConnection = new RTCPeerConnection(configuration);
    registerPeerConnectionListeners();
    localStream.getTracks().forEach(track => {
      peerConnection.addTrack(track, localStream);
    });

    // Code for collecting ICE candidates below
    const calleeCandidatesCollection = roomRef.collection('calleeCandidates');
    peerConnection.addEventListener('icecandidate', event => {
      if (!event.candidate) {
        console.log('Got final candidate!');
        return;
      }
      console.log('Got candidate: ', event.candidate);
      calleeCandidatesCollection.add(event.candidate.toJSON());
    });
    // Code for collecting ICE candidates above

    peerConnection.addEventListener('track', event => {
      console.log('Got remote track:', event.streams[0]);
      event.streams[0].getTracks().forEach(track => {
        console.log('Add a track to the remoteStream:', track);
        remoteStream.addTrack(track);
      });
    });

    // Code for creating SDP answer below
    const offer = roomSnapshot.data().offer;
    console.log('Got offer:', offer);
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
    console.log('Created answer:', answer);
    await peerConnection.setLocalDescription(answer);

    const roomWithAnswer = {
      answer: {
        type: answer.type,
        sdp: answer.sdp,
      },
    };
    await roomRef.update(roomWithAnswer);
    // Code for creating SDP answer above

    // Listening for remote ICE candidates below
    roomRef.collection('callerCandidates').onSnapshot(snapshot => {
      snapshot.docChanges().forEach(async change => {
        if (change.type === 'added') {
          let data = change.doc.data();
          console.log(`Got new remote ICE candidate: ${JSON.stringify(data)}`);
          await peerConnection.addIceCandidate(new RTCIceCandidate(data));
        }
      });
    });
    // Listening for remote ICE candidates above
  }
  

  const usersInfo = roomRef.collection('userInfo');
  const remoteNameDOM = document.getElementById('remoteName');
  const chatNameDOM = document.getElementById('title');
  usersInfo.doc('joiner').set({
    joinerName: localName
  })
  usersInfo.onSnapshot(snapshot => {
    snapshot.docChanges().forEach(async change => {
      if (change.type === 'added'){
        if (change.doc.id == "creator"){
          let data = await change.doc.data().creatorName;
          remoteNameDOM.innerHTML = `${data} (Other)`;
          chatNameDOM.innerHTML = `Chatting with ${data}`;
        }
      }
    })
  })

  if (roomId != null){
    const db = firebase.firestore();
    const chatsRef = await db.collection('rooms').doc(roomId).collection('messages');
    const query = chatsRef.orderBy('createdAt');
    chatsRef.onSnapshot(snapshot => {
      snapshot.docChanges().forEach(async change => {
        if (change.type === 'added'){
          let data = change.doc.data();
          if (data.userID != localID){
            send_Message(data.message, "left", data.userPhoto);
          }
        }
      })
    })
  }
}

async function openUserMedia(e) {
  const stream = await navigator.mediaDevices.getUserMedia(
      {video: true, audio: true});
  document.querySelector('#localVideo').srcObject = stream;
  localStream = stream;
  remoteStream = new MediaStream();
  document.querySelector('#remoteVideo').srcObject = remoteStream;

  console.log('Stream:', document.querySelector('#localVideo').srcObject);
  document.querySelector('#cameraBtn').disabled = true;
  document.querySelector('#joinBtn').disabled = false;
  document.querySelector('#createBtn').disabled = false;
  document.querySelector('#hangupBtn').disabled = false;
}

async function hangUp(e) {
  const tracks = document.querySelector('#localVideo').srcObject.getTracks();
  tracks.forEach(track => {
    track.stop();
  });

  if (remoteStream) {
    remoteStream.getTracks().forEach(track => track.stop());
  }

  if (peerConnection) {
    peerConnection.close();
  }

  document.querySelector('#localVideo').srcObject = null;
  document.querySelector('#remoteVideo').srcObject = null;
  document.querySelector('#cameraBtn').disabled = false;
  document.querySelector('#joinBtn').disabled = true;
  document.querySelector('#createBtn').disabled = true;
  document.querySelector('#hangupBtn').disabled = true;
  document.querySelector('#currentRoom').innerText = '';

  // Delete room on hangup
  if (roomId) {
    const db = firebase.firestore();
    const roomRef = db.collection('rooms').doc(roomId);
    const calleeCandidates = await roomRef.collection('calleeCandidates').get();
    calleeCandidates.forEach(async candidate => {
      await candidate.ref.delete();
    });
    const callerCandidates = await roomRef.collection('callerCandidates').get();
    callerCandidates.forEach(async candidate => {
      await candidate.ref.delete();
    });
    await roomRef.delete();
  }

  document.location.reload(true);
}

function registerPeerConnectionListeners() {
  peerConnection.addEventListener('icegatheringstatechange', () => {
    console.log(
        `ICE gathering state changed: ${peerConnection.iceGatheringState}`);
  });

  peerConnection.addEventListener('connectionstatechange', () => {
    console.log(`Connection state change: ${peerConnection.connectionState}`);
  });

  peerConnection.addEventListener('signalingstatechange', () => {
    console.log(`Signaling state change: ${peerConnection.signalingState}`);
  });

  peerConnection.addEventListener('iceconnectionstatechange ', () => {
    console.log(
        `ICE connection state change: ${peerConnection.iceConnectionState}`);
  });
}

init();

// Authentication

const signInBtn = document.getElementById('signIn');
const signOutBtn = document.getElementById('signOut');
const sect0 = document.getElementById('section0');
const sect1 = document.getElementById('section1');
signInBtn.onclick = () => googleLogin();
signOutBtn.onclick = () => logOut();

function googleLogin(){
  const provider = new firebase.auth.FacebookAuthProvider();

  firebase.auth().signInWithPopup(provider)
    .then(function() {
      console.log("Login Successful");
    })
}

function logOut(){
  firebase.auth().signOut()
    .then(function() {
      console.log("Logout Successful");
    })
}

const localNameDOM = document.getElementById('localName');

let localID;
let localName;
let localPhoto;
let remoteUser;
document.addEventListener("DOMContentLoaded", async event => {
  firebase.auth().onAuthStateChanged(user => {
    if (user){
      sect0.style.display = "none";
      sect1.style.display = "block";
      localID = user.uid;
      localName = user.displayName;
      localPhoto = user.photoURL;
      localNameDOM.innerHTML = `${localName} (You)`;

    }
    else{
      sect0.style.display = "block";
      sect1.style.display = "none";
    }
  })
  
  
})


// Live-Chat

  // Message Object
  var Message;
  Message = function (arg) {
      this.text = arg.text, this.message_side = arg.message_side;
      this.draw = function (_this) {
          return function () {
              var $message;
              $message = $($('.message_template').clone().html());
              $message.addClass(_this.message_side).find('.text').html(_this.text);
              $('.messages').append($message);
              return setTimeout(function () {
                  return $message.addClass('appeared');
              }, 0);
          };
      }(this);
      return this;
  };
  var Message2;
  Message2 = function (arg) {
    this.text = arg.text, this.message_side = arg.message_side;
    this.draw = function (_this) {
        return function () {
            let $message;
            $message = $($('.message_template_remote').clone().html());
            $message.addClass(_this.message_side).find('.text').html(_this.text);
            $('.messages').append($message);
            return setTimeout(function () {
                return $message.addClass('appeared');
            }, 0);
        };
    }(this);
    return this;
};
  
  $(async function () {
    // Grabs comment
      var getMessageText, sendMessage;
      getMessageText = function () {
          var $message_input;
          $message_input = $('.message_input');
          return $message_input.val();
      };
      // Updates messages
      sendMessage = await async function (text, message_side) { // NOTE: make sure to check if roomId exists yet (if they have either joined or created a room)
          if (roomId != null){
            var $messages, message;
            if (text.trim() === '') {
                return;
            }
            $('.message_input').val('');
            $messages = $('.messages');
            message_side = message_side === 'left' ? 'left' : 'right';

            // Create message document in Firebase
            if (message_side == 'right'){
              const db = firebase.firestore();
              const chatRef = await db.collection('rooms').doc(roomId).collection('messages');
              const { serverTimestamp } = firebase.firestore.FieldValue;
              chatRef.add({
                userID: localID,
                createdAt: serverTimestamp(),
                message: text,
                userPhoto: localPhoto
              })
            }
            
            // Create physical message object and update screen
            message = new Message({
                text: text,
                message_side: message_side
            });
            let style = document.createElement("style");
            style.id = "style";
            style.type = "text/css";
            document.head.appendChild(style);
            let main = style.sheet;
            main.insertRule(`.avatar_right {background: url(${localPhoto}) top 0% center;}`);
            message.draw();
            return $messages.animate({ scrollTop: $messages.prop('scrollHeight') }, 300);
          }
      };

      // Event Listeners
      $('.send_message').click(function (e) {
          return sendMessage(getMessageText(), "right");
      });
      $('.message_input').keyup(function (e) {
          if (e.which === 13) {
              return sendMessage(getMessageText());
          }
      });
  });

  async function send_Message(text, message_side, remotePhoto) { // NOTE: make sure to check if roomId exists yet (if they have either joined or created a room)
    if (roomId != null){
      var $messages, message;
      if (text.trim() === '') {
          return;
      }
      $messages = $('.messages');
      message_side = message_side === 'left' ? 'left' : 'right';

      // Create message document in Firebase

      // Create physical message object and update screen
      message = new Message2({
          text: text,
          message_side: message_side
      });
      let style = document.createElement("style");
      style.id = "style";
      style.type = "text/css";
      document.head.appendChild(style);
      let main = style.sheet;
      main.insertRule(`.avatar_left {background: url(${remotePhoto}) top 0% center;}`);
      
      message.draw();
      return $messages.animate({ scrollTop: $messages.prop('scrollHeight') }, 300);
    }
};

const videoRemote = document.getElementById('remoteVideo');
const muteButton = document.getElementById('mute');
muteButton.onclick = () => mute();
function mute(){
  console.log("Working?");
  console.log(muteButton.textContent);
  if (muteButton.textContent == "Mute"){
    videoRemote.setAttribute('muted', 'muted');
    muteButton.innerHTML = `Unmute`;
  }
  else{
    videoRemote.removeAttribute('muted');
    muteButton.innerHTML = `Mute`;
  }
}

