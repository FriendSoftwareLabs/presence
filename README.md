# Presence

Presence is a communication service for Friend. It is based on rooms, 
allowing many to many text chat and video / audio calls. It integrates 
closely with ( and is a service of ) Friend, allowing anyone 
logged into Friend to use it, showing up with their Friend name, 
with no need to set up an account or remember a password. A pixel 
avatar is generated for everyones amusement.

### Live

Each room functions as a signaling service for webRTC peer to peer video and 
audio conferencing. This makes it easy to organize a conference as each 
participant can join and leave as he pleases. If someone get disconnected 
they can quickly rejoin, and maybe check links posted to chat in the meantime.

In a collaboration environment is is also easy for others in the room
too see that things are happening on live and to join in.

### Peer to peer connections

webRTC is used for Live connections. It needs to know the IPs of the peers
trying to connect ( among other things ). The internet being full of firewalls
and other dark things, this would be quite hit-and-miss. This is where STUN/TURN
is useful. First STUN servers are used as a 3rd party to discover your 'public'
IP. If this fails, the connection can no longer be directly peer to peer,
but falls back on a TURN server to relay the stream. This TURN relay can also
be used as a service to hide each users IP from each other.

### Persistent, or not

All rooms start out in a unnamed state. Chat log in these rooms is not
saved, neither are participants. Once everyone has logged off or left, the room
will be purged. This is good for one-off live sessions, but if you decide
there is value in keeping the room, it can be given a name and current chat log
and users will be persisted.

### Guests

Invites can be generated and either sent directly to another person through
one of the other Friend Chat modules, or shared as a clickable link. These can
be single-use or public. The public ones can be used by any number of people
until it is canceled through the interface or the room empties and is removed
from server memory.


### Immediate response

Persistent connections are used to ensure all events are promptly delivered. Both
vanilla TCP and websockets are used, depending on client needs. For mobile users,
these connections are seamlessly reestablished when switching networks, ie
wifi -> mobile data.

### Limitations

In a slightly odd position, presence is currently only available through
Friend Chat. You start out with no rooms, but can create a room, invite
someone into it or join other rooms. To send or receive an invite
having an active IRC ( you should start with one as default ) or Treeroot
module is currently a requirement. Friend workgroup and users integration
will happen shortly to fix much of this. Only users on the local Friend
node can be saved to a room, but guest invites are open to anyone.

## Setup

We suggest to install Presence through the Friend Chat installer. It will
take all the parameters into account, and configure Friend Core, Friend Chat and
Presence accordingly.

To run the Friend Chat installer, go to the friendchat folder you cloned from GIT
and type ./install.sh

We will provide in the near future a Presence specific installer.

## Running the Presence server

Presence is automatically launched when Friend Core is launched if you have used
the Friend Chat installer. If you kill Friend Core instead of quitting, you will
have to kill it manually (look for node tasks).

### Development

For development purposes, it is probably better to clone this repo to a
more convenient place and use the provided update.sh script to move files to
the appropriate Friend folder and perform the necessary 'npm install' command.

### Running

While in the Presence folder, the server can be run directly with `node presence.js`,
or FriendCore can autostart it when it starts up. It can also be run through the
provided phoenix script, which will write to error.log and restart.log and pick
it back up if it falls down.

## SDK / API

A SDK is coming, allowing easy embedding of the presence service in apps or websites.
It should come with some predefined widgets to get things up and running quickly, but
also expose base classes to allow greater customization.

## License

Presence is licenced under AGPLv3
