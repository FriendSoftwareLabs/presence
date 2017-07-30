'use strict';

/*©agpl*************************************************************************
*                                                                              *
* Friend Unifying Platform                                                     *
* ------------------------                                                     *
*                                                                              *
* Copyright 2014-2016 Friend Software Labs AS, all rights reserved.            *
* Hillevaagsveien 14, 4016 Stavanger, Norway                                   *
* Tel.: (+47) 40 72 96 56                                                      *
* Mail: info@friendos.com                                                      *
*                                                                              *
*****************************************************************************©*/

const log = require( './Log')( 'RoomCtrl' );
const uuid = require( './UuidPrefix' )( 'room' );
const dFace = require( './DFace' );
const Room = require( './Room' );

var ns = {};
ns.RoomCtrl = function( dbPool ) {
	const self = this;
	self.dbPool = dbPool;
	self.roomDb = null;
	self.accDb = null;
	
	self.rooms = {};
	self.roomIds = [];
	
	self.init();
}

// Public

ns.RoomCtrl.prototype.createRoom = function( identity, conf, callback ) {
	const self = this;
	if ( !identity || !identity.clientId || !identity.name )
		throw new Error( 'RoomCtrl.joinRoom - invalid identity' );
	
	conf = conf || {};
	if ( null == conf.name )
		self.createAnonRoom( identity, callback );
	else
		self.createNamedRoom( identity, conf, callback );
}

ns.RoomCtrl.prototype.joinRoom = function( identity, conf, callback ) {
	const self = this;
	if ( !identity || !identity.clientId || !identity.name )
		throw new Error( 'RoomCtrl.joinRoom - invalid identity' );
	
	if ( conf.token )
		self.joinWithInvite( identity, conf, callback );
	else
		self.joinWithAuth( identity, conf, callback );
}

ns.RoomCtrl.prototype.authorizeGuestInvite = function( bundle, callback ) {
	const self = this;
	if ( !callback )
		return false;
	
	self.getRoom( bundle.roomId )
		.then( roomBack )
		.catch( roomErr );
	
	function roomBack( room ) {
		if ( !room ) {
			callback( null );
			return;
		}
		
		const valid = room.authenticateInvite( bundle.token );
		if ( valid )
			callback( room.id );
		else
			callback( false );
	}
	
	function roomErr( err ) {
		callback( false );
	}
}

ns.RoomCtrl.prototype.guestJoinRoom = function( account, roomId, callback ) {
	const self = this;
	if ( !callback )
		return false;
	
	self.getRoom( roomId )
		.then( roomBack )
		.catch( roomErr );
	
	function roomBack( room ) {
		if ( !room ) {
			callback( null );
			return;
		}
		
		account.guest = true;
		self.addToRoom( account, roomId );
		const user = room.connect( account.clientId );
		callback( user );
	}
	
	function roomErr( err ) {
		log( 'guestJoinRoom - getRoom err', err.stack || err );
		callback( false );
	}
}

// go online in a room  - the room will start sending events to this client
ns.RoomCtrl.prototype.connect = function( accountId, roomId, callback ) {
	const self = this;
	if ( !callback )
		return false;
	
	self.getRoom( roomId )
		.then( roomBack )
		.catch( roomErr );
	
	function roomBack( room ) {
		if ( !room ) {
			callback( null );
			return;
		}
		
		const user = room.connect( accountId );
		callback( user );
	}
	
	function roomErr( err ) {
		log( 'connect - getRoom err', err.stack || err );
		callback( false );
	}
}

// closes roomCtrl, not a room
ns.RoomCtrl.prototype.close = function() {
	const self = this;
	if ( self.roomDb )
		self.roomDb.close();
	
	// TODO : close rooms
	
	delete self.roomDb;
	delete self.dbPool;
}

// Private

ns.RoomCtrl.prototype.init = function() {
	const self = this;
	log( 'room ctrl init ^__^' );
	self.roomDb = new dFace.RoomDB( self.dbPool );
	self.accDb = new dFace.AccountDB( self.dbPool );
}

ns.RoomCtrl.prototype.createNamedRoom = function( account, conf, callback ) {
	const self = this;
	log( 'createNamedRoom', conf );
}

ns.RoomCtrl.prototype.createAnonRoom = function( account, callback ) {
	const self = this;
	const ownerId = account.clientId;
	const roomId = uuid.get();
	const roomConf = {
		clientId   : roomId,
		ownerId    : ownerId,
		name       : '[ temp ] created by: ' + account.name,
	};
	self.setRoom( roomConf )
		.then( roomOpen )
		.catch( roomErr );
	
	function roomOpen( room ) {
		if ( !room ) {
			callback( 'ERR_NO_ROOM_???', null );
			return;
		}
		
		self.addToRoom( account, roomId );
		const user = room.connect( account.clientId );
		callback( null, user );
	}
	
	function roomErr( err ) {
		log( 'createAnonRoom - setRoom err', err.stack || err );
		callback( null );
	}
}

ns.RoomCtrl.prototype.joinWithInvite = function( account, conf, callback ) {
	const self = this;
	if ( !callback )
		return false;
	
	const rid = conf.roomId;
	const room = self.getRoom( rid )
		.then( roomBack )
		.catch( roomErr );
	
	function roomBack( room ) {
		if ( !room ) {
			callback( 'ERR_NO_ROOM', null );
			return;
		}
		
		const isValid = room.authenticateInvite( conf.token );
		if ( !isValid ) {
			callback( 'ERR_INVITE_INVALID', null );
			return;
		}
		
		self.authorizeForRoom( account, rid );
		const user = room.connect( account.clientId );
		callback( null, user );
	}
	
	function roomErr( err ) {
		log( 'joinWithInvite - getRoom err', err.stack || err );
		callback( err, null );
	}
}

ns.RoomCtrl.prototype.joinWithAuth = function( accountId, conf, callback ) {
	const self = this;
	callback( 'ERR_NYI_FUCKO', null );
	return false;
}

ns.RoomCtrl.prototype.setRoom = function( roomConf ) {
	const self = this;
	const roomId = roomConf.clientId;
	return new Promise( openRoom );
	function openRoom( resolve, reject ) {
		const roomId = roomConf.clientId;
		const room = new Room( roomConf, self.dbPool, onEmpty, onOpen );
		self.rooms[ room.id ] = room;
		self.roomIds = Object.keys( self.rooms );
		
		function onOpen() {
			resolve( self.rooms[ roomId ]);
		}
	}
	
	function onEmpty() { self.removeRoom( roomId ); }
}

ns.RoomCtrl.prototype.persistRoom = function( room ) {
	const self = this;
	self.roomDb.set( room.id, room.name, room.ownerId, true )
		.then( setBack )
		.catch( setErr );
	
	function setBack( res ) {
		//log( 'persistRoom - persist back', res );
	}
	
	function setErr( err ) {
		log( 'persistRoom - persist err', {
			room : room,
			err  : err,
		});
	}
}

ns.RoomCtrl.prototype.getRoom = function( rid ) {
	const self = this;
	return new Promise( getRoom );
	function getRoom( resolve, reject ) {
		var room = self.rooms[ rid ];
		if ( room ) {
			resolve( room );
			return;
		}
		
		self.roomDb.get( rid )
			.then( loaded )
			.catch( loadErr );
			
		function loaded( roomConf ) {
			if ( !roomConf ) {
				resolve( null );
				return;
			}
			
			roomConf.persistent = true;
			self.setRoom( roomConf )
				.then( roomOpen )
				.catch( loadErr );
				
			function roomOpen( room ) {
				resolve( room );
			}
		}
		
		function loadErr( err ) {
			log( 'getRoom - db err', {
				rid : rid,
				err : err,
			});
			reject( err );
		}
	}
}

ns.RoomCtrl.prototype.removeRoom = function( rid ) {
	const self = this;
	var room = self.rooms[ rid ];
	if ( !room )
		return;
	
	room.close( closeBack );
	function closeBack() {
		delete self.rooms[ rid ];
		self.roomIds = Object.keys( self.rooms );
	}
}

// account

ns.RoomCtrl.prototype.loadAccount = function( accountId, callback ) {
	const self = this;
	self.accDb.getById( accountId )
		.then( loadBack )
		.catch( fail );
	
	function loadBack( acc ) {
		if ( !acc.name ) {
			callback( 'ERR_ACCOUNT_NONAME', null );
			return;
		}
		
		callback( null, acc );
	}
	
	function fail( err ) {
		callback( err, null );
	}
}

// use for real users
// dont use this for guests ( they dont have a real account anyway so will fail )
ns.RoomCtrl.prototype.authorizeForRoom = function( account, roomId ) {
	const self = this;
	const room = self.rooms[ roomId ];
	if ( !room ) {
		// TODO : save auth to db
		return;
	}
	
	const user = {
		accountId   : account.clientId,
		accountName : account.name,
	};
	room.authorizeUser( user );
	
}

// use for guest accounts
// dont use this for real accounts, the authorization wont be persisted
ns.RoomCtrl.prototype.addToRoom = function( account, roomId ) {
	const self = this;
	const room = self.rooms[ roomId ];
	if ( !room )
		return false;
	
	const user = {
		accountId   : account.clientId,
		accountName : account.name,
		guest       : account.guest,
	};
	room.addUser( user );
	
}

ns.RoomCtrl.prototype.removeFromRoom = function( accountId, roomId ) {
	const self = this;
	log( 'removeFromRoom', accountId );
}


module.exports = ns.RoomCtrl;
