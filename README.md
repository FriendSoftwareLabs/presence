# Presence

Presence is a communication service for Friend. It is based on rooms, 
allowing many to many text chat and video / audio calls. It integrates 
closely with ( and is a service of ) Friend, allowing anyone 
logged into Friend to use it, showing up with their Friend name, 
with no need to set up an account or remember a password. A pixel 
avatar is generated for everyones amusement.

### "I just want to type things at people"

In a slighlty odd position, presence is currently only available through 
FriendChat. You start out with no rooms, but can create a room, invite 
someone into it or join other rooms. To send or receive an invite 
having an active IRC ( you should start with one as default ) or Treeroot 
module is currently a requirement. Friend workgroup and users integration 
will happen shortly.

### Persistent, or not

All rooms start out in a unnamed state. Chat log in these rooms is not 
saved, neither are participants. Once everyone has logged of or left, the room 
will be purged. This is good for one-off live sessions, but if you decide 
there is value in keeping the room, it can be given a name and current chat log 
and users will be persisted.

### Immediate response

Persistent connections are used to ensure all events are promptly delivered. Both 
vanilla TCP and websockets are used, depending on client needs. For mobile users, 
these connections are seamlessly reestablished when switcing networks, ie 
wifi -> mobile data.

## Setup

Requires: 
* FriendCore
* node.js
* mysql

If node.js is not already present, the install script will do what
exactly? If its suggesting / installing, make sure to use n, https://github.com/tj/n,
aka node jesus.

### Installing

Presence is an option to install when Friend is installed. If this was not done, 
scripts are still provided i think? Francois will tell you more, im sure.
This installation clones into the build directory of Friend.

### Development

For development purposes, it is probably better to clone this repo to a 
more convenient place and use the provided update.sh script to move files to 
the appropriate folder.

### Running

While in the Presence folder, the server can be run directly with `node presence.js`,
or FriendCore can autostart it when it starts up, or it can be run through the 
provided phoenix script, which will write to error.log and restart.log and pick 
it back up if it falls down.

## SDK / API

A SDK is coming, allowing easy embedding of the presence service in apps or websites. 
It should come with some predefined widgets to get things up and runnig quickly, but 
also expose base classes to allow greater customization.

### Documentation

Oh, you sweet summer child..


## License

Presence is licenced under AGPLv3
