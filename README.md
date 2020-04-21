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

## Installing and configuration

Presence installer is called by the Friend Chat installer. It will collect some
info, and configure Friend Core, Friend Chat and Presence accordingly. Not everything 
is handled by the install script ( becuase its old and needs to be rewritten in not-bash ).

To run the Friend Chat installer, go to the friendchat folder you cloned from GIT
and run `./install.sh`

After install process, a few things need to be set manually. Only edit `config.js` in
install folder. If a value is not found in config.js it falls back to example.config.js
for a default value.

For presence to talk to FriendCore, it must establish a connection and indentify itself.
In FriendCore cfg.ini, there must be a header `[SerivceKeys]` with a key/value pair
`presence = <your secret key>`. This must also be added to Presence config.js under
`server -> friendcore` as `serviceKey : '<your secret key>'`. The secret key can be any string.

### Streaming / Janus

As the number of participants in a Live call increases the resource use ( encoding / upload bandwidth )
of a peer-to-peer mesh becomes prohibitive. To solve this we use a central webRTC bridge
that receives a stream from one peer and distrbutes it the other participants. We use Janus for
this.

To install Janus, go into the Janus folder in the Presence install folder. Here there is a readme
with probably useful info and an install script. The readme contains solutions to known issues
enconuntered when bulding Janus. It also has configuration specifics.

For the time being, each streaming room requires static configuration in Janus config, check
janus readme.

To set up a room for streaming, a streaming workgroup must be specified and assigned to a room.
This is currently done with a Friend setting:

1. open Server app
2. Add item, `type: 'presence'`, `key: 'systemsettings'`
3. Edit the added item and add property, `key: 'stream_groups', value: '<name of workgroup>'`

Next time someone logs into presence this setting will be read. Assigning this workgroup
to a room will now cause any live session to be in a streaming mode. Any participant who is
not in the specified workgroup can only watch. Users assigned to the streaming workgroup
who join the live session will be set as the streamer/source and their audio/video 
distributed to all participants over Janus. Only the first member of the streaming workgroup
to join will be set as streamer.

Recording can be enabled in janus static room config.

## Running the Presence server

Presence can run as a service if this option was chosen during installation, or 
the provided auto restart script can be used.

As a service: `sudo service presence-server start`
By script from Presence install folder: `nohup sh phoenix_presence.sh &`

Running the update.sh script from the git folder will also attempt to (re)start
presence as a service, unless some additional argument is passed.

When running on the restart script, logs will be written to error.log and restart.log
in the Presence install folder.

## License

Presence is licenced under AGPLv3
