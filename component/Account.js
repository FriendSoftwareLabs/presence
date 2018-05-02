'use strict';

/*©agpl*************************************************************************
*                                                                              *
* This file is part of FRIEND UNIFYING PLATFORM.                               *
*                                                                              *
* This program is free software: you can redistribute it and/or modify         *
* it under the terms of the GNU Affero General Public License as published by  *
* the Free Software Foundation, either version 3 of the License, or            *
* (at your option) any later version.                                          *
*                                                                              *
* This program is distributed in the hope that it will be useful,              *
* but WITHOUT ANY WARRANTY; without even the implied warranty of               *
* MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the                 *
* GNU Affero General Public License for more details.                          *
*                                                                              *
* You should have received a copy of the GNU Affero General Public License     *
* along with this program.  If not, see <http://www.gnu.org/licenses/>.        *
*                                                                              *
*****************************************************************************©*/

const Emitter = require( './Events' ).Emitter;
const dFace = require( './DFace' );
const uuid = require( './UuidPrefix' )( '' );
const util = require( 'util' );

var ns = {};
ns.Account = function(
	conf,
	session,
	dbPool,
	roomCtrl
) {
	const self = this;
	self.id = conf.clientId;
	self.login = conf.login;
	self.auth = conf.auth;
	self.identity = conf.identity;
	self.settings = conf.settings;
	self.session = session;
	self.dbPool = dbPool;
	self.roomCtrl = roomCtrl;
	
	self.rooms = null;
	
	self.init();
}

// Public

ns.Account.prototype.close = function() {
	const self = this;
	self.logout( outBack );
	function outBack() {
		if ( self.roomCtrl ) {
			self.roomCtrl.off( self.wgAssEventId );
		}
		
		delete self.dbPool;
		delete self.roomCtrl;
		delete self.onclose;
	}
}

// Private

ns.Account.prototype.init = function() {
	const self = this;
	// prepare 'personalized' logging
	var logStr = 'Account-' + self.login;
	self.log = require( './Log' )( logStr );
	
	self.wgAssEventId = self.roomCtrl.on( 'workgroup-assigned', wgAssigned );
	
	function wgAssigned( wg, roomId ) { self.handleWorkgroupAssigned( wg, roomId ); }
	
	self.setIdentity();
	
	//
	self.session.on( 'initialize', init );
	self.session.on( 'identity', identity );
	self.session.on( 'settings', handleSettings );
	self.session.on( 'room', handleRoomMsg );
	self.session.on( 'join', joinRoom );
	self.session.on( 'create', createRoom );
	
	// rooms is a collection of chat rooms
	self.rooms = new ns.Rooms( self.session );
	self.rooms.on( 'close', roomClosed );
	//self.rooms.on( 'join', joinedRoom );
	//self.rooms.on( 'leave', leftRoom );
	
	function onNoClients() { self.close(); }
	function init( e, cid ) { self.initializeClient( e, cid ); }
	function identity( e, cid ) { self.updateIdentity( e, cid ); }
	function handleSettings( e, cid ) { self.handleSettings( e, cid ); }
	function handleRoomMsg( e, cid ) { self.log( 'roomMsg', msg ); }
	function joinRoom( e, cid ) { self.joinRoom( e, cid ); }
	function createRoom( e, cid ) { self.createRoom( e, cid ); }
	
	function roomClosed( e ) { self.handleRoomClosed( e ); }
	//function joinedRoom( e, rid ) { self.handleJoinedRoom( e, rid ); }
	//function leftRoom( e, rid ) { self.handleLeftRoom( e, rid ); }
}

ns.Account.prototype.handleWorkgroupAssigned = function( addedWorg, roomId ) {
	const self = this;
	if ( self.rooms.isParticipant( roomId )) {
		self.log( 'handleWorkgroupAssigned - is participant', roomId );
		return;
	}
	
	let isMember = self.auth.workgroups.member.some( checkIsMember );
	if ( !isMember )
		return;
	
	const account = self.buildRoomAccount();
	self.roomCtrl.connectWorkgroup( account, roomId, roomBack );
	
	function checkIsMember( worg ) {
		return worg.clientId === addedWorg.cId;
	}
	
	function roomBack( err, room ) {
		if ( err )
			return;
		
		self.joinedARoomHooray( room );
	}
}

ns.Account.prototype.initializeClient = function( event, clientId ) {
	const self = this;
	const state = {
		type : 'initialize',
		data : {
			account  : {
				host     : global.config.shared.wsHost,
				clientId : self.id,
				login    : self.login,
				name     : self.identity.name,
				auth     : self.auth,
			},
			rooms    : self.rooms.getRooms(),
		},
	};
	self.session.send( state, clientId );
	if ( self.initialized )
		return;
	
	self.initialized = true;
	self.loadRooms();
}

ns.Account.prototype.setIdentity = function( id ) {
	const self = this;
	id = id || self.identity || {};
	let name = id.name || id.alias;
	let avatar = id.avatar || self.settings.avatar;
	if ( !avatar ) {
		const tinyAvatar = require( './TinyAvatar' );
		avatar = tinyAvatar.generate( name )
			.then( res => setId( res ))
			.catch( err => setId( null ));
	} else
		setId( avatar );
	
	function setId( avatar ) {
		avatar = avatar || '';
		self.identity = {
			clientId : self.id,
			name     : name,
			avatar   : avatar,
			email    : id.email,
		};
		
		updateDb( self.identity.name );
	}
	
	function updateDb( name ) {
		const accDb = new dFace.AccountDB( self.dbPool );
		accDb.updateName( self.id, name )
			.then( nameOK )
			.catch( nameErr );
			
		function nameOK( res ) {
			//self.log( 'updateIdentity nameOK', res, 3 );
		}
		
		function nameErr( err ) {
			if ( !err )
				return;
			
			self.log( 'updateIdentity nameErr', err.stack || err );
		}
	}
	
	function persistAvatar( avatar, callback ) {
		const accDb = new dFace.AccountDB( self.dbPool );
		accDb.updateAvatar( self.id, avatar )
			.then( res => callback( null, res ))
			.catch( callback );
	}
}

ns.Account.prototype.updateIdentity = function( id, cid ) {
	const self = this;
	const name = id.name || id.alias || '';
	self.setIdentity( id );
}

ns.Account.prototype.handleSettings = function( msg, cid ) {
	const self = this;
	self.log( 'handleSettings - NYI', msg );
}

ns.Account.prototype.loadRooms = function() {
	const self = this;
	const roomDb = new dFace.RoomDB( self.dbPool );
	roomDb.getForAccount( self.id, self.auth.workgroups.member )
		.then( roomsBack )
		.catch( loadError );
	
	function roomsBack( list ) {
		list.forEach( connect );
		function connect( room ) {
			const account = self.buildRoomAccount();
			if ( room.wgs )
				self.roomCtrl.connectWorkgroup( account, room.clientId, roomBack );
			else
				self.roomCtrl.connect( account, room.clientId, roomBack );
		}
	}
	
	function roomBack( err, room ) {
		if ( err ) {
			self.log( 'loadRoom.roomBack err', err.stack || err );
			return;
		}
		
		self.joinedARoomHooray( room );
	}
	
	function loadError( err ) {
		self.log( 'roomLoadErr', err.stack || err );
	}
}

ns.Account.prototype.joinRoom = function( conf, cid ) {
	const self = this;
	const account = self.buildRoomAccount();
	self.roomCtrl.joinRoom( account, conf.invite, roomBack );
	function roomBack( err, room ) {
		if ( err || !room ) {
			self.log( 'failed to join a room', {
				err  : err.stack || err,
				room : room,
				conf : conf, }, 4 );
			return;
		}
		
		self.joinedARoomHooray( room, conf.req );
	}
}

ns.Account.prototype.createRoom = function( conf, cid ) {
	const self = this;
	conf = conf || {};
	const account = self.buildRoomAccount();
	self.roomCtrl.createRoom( account, conf, roomBack );
	function roomBack( err, room ) {
		if ( err || !room ) {
			self.log( 'failed to set up a room', {
				err  : err.stack || err,
				room : room,
				conf : conf,
			}, 4 );
			return;
		}
		
		self.joinedARoomHooray( room, conf.req );
	}
}

ns.Account.prototype.connectedRoom = function( room ) {
	const self = this;
	const connected = {
		type : 'connect',
		data : {
			clientId   : room.roomId,
			persistent : room.persistent,
			name       : room.roomName,
		},
	};
	self.session.send( connected, sendBack );
	function sendBack( err ) {
		self.rooms.add( room );
		room.setIdentity( self.identity );
	}
}

ns.Account.prototype.joinedARoomHooray = function( room, reqId  ) {
	const self = this;
	if ( !room ) {
		self.log( 'joinedARoom - didnt join a room', room );
		return;
	}
	
	var res = {
		clientId   : room.roomId,
		persistent : room.persistent,
		name       : room.roomName,
		req        : reqId,
	};
	var joined = {
		type : 'join',
		data : res,
	};
	self.session.send( joined, null, sendBack );
	function sendBack( err ) {
		self.rooms.add( room );
		room.setIdentity( self.identity );
	}
}

ns.Account.prototype.buildRoomAccount = function() {
	const self = this;
	return {
		clientId   : self.id,
		name       : self.identity.name,
		avatar     : self.identity.avatar,
		admin      : self.auth.admin,
		workgroups : self.auth.workgroups,
	};
}

ns.Account.prototype.handleRoomClosed = function( roomId ) {
	const self = this;
	const close = {
		type : 'close',
		data : roomId,
	};
	self.session.send( close );
}

ns.Account.prototype.logout = function( callback ) {
	const self = this;
	if ( self.rooms )
		self.rooms.close();
	
	if ( self.session )
		self.session.close();
	
	delete self.rooms;
	delete self.session;
	
	if ( callback )
		callback();
}

// ROOMS

const rlog = require( './Log' )( 'account > rooms' );

ns.Rooms = function( session ) {
	const self = this;
	Emitter.call( self );
	self.session = session;
	
	self.rooms = {};
	self.list = [];
	
	self.init();
}

util.inherits( ns.Rooms, Emitter );

// Public

ns.Rooms.prototype.send = function( event, roomId ) {
	const self = this;
	var room = self.rooms[ roomId ];
	if ( !room )
		return;
	
	room.toRoom( event );
}

ns.Rooms.prototype.add = function( room ) {
	const self = this;
	const rid = room.roomId;
	self.rooms[ rid ] = room;
	self.list.push( rid );
	self.session.on( rid, fromClient );
	room.setToAccount( fromRoom );
	room.setOnclose( onClose );
	function fromRoom( e ) { self.handleRoomEvent( e, rid ); }
	function fromClient( e ) { self.handleClientEvent( e, rid ); }
	function onClose( e ) { self.handleRoomClosed( rid ); }
}

ns.Rooms.prototype.isParticipant = function( roomId ) {
	const self = this;
	return !!self.rooms[ roomId ];
}

ns.Rooms.prototype.remove = function( roomId ) {
	const self = this;
	const rid = roomId;
	self.session.release( rid );
	var room = self.rooms[ rid ];
	if ( !room )
		return null;
	
	delete self.rooms[ rid ];
	self.list = Object.keys( self.rooms );
}

ns.Rooms.prototype.getRooms = function() {
	const self = this;
	const rooms = self.list
		.map( idAndName );
		
	return rooms;
	
	function idAndName( rid ) {
		const room = self.rooms[ rid ];
		return {
			clientId   : rid,
			persistent : room.persistent,
			name       : room.roomName,
		};
	}
}

ns.Rooms.prototype.close = function() {
	const self = this;
	self.release();
	releaseClients();
	leaveRooms();
	
	delete self.session;
	self.rooms = {};
	
	function releaseClients() {
		for( const rid in self.rooms )
			self.session.release( rid );
	}
	
	function leaveRooms() {
		if ( !self.rooms )
			return;
		
		for ( const rid in self.rooms )
			self.rooms[ rid ].disconnect();
	}
}

// Private

ns.Rooms.prototype.init = function() {
	const self = this;
	
}

ns.Rooms.prototype.handleRoomEvent = function( event, roomId ) {
	const self = this;
	// TODO : use EventNode
	var res = self.emit( event.type, event.data, roomId );
	if ( null == res ) // event was sent
		return;
	
	// noone want this event.. lets package and send to clients
	const eventWrap = {
		type : roomId,
		data : event,
	};
	self.session.send( eventWrap );
}

ns.Rooms.prototype.handleClientEvent = function( event, roomId ) {
	const self = this;
	const room = self.rooms[ roomId ];
	if ( !room ) {
		rlog( 'no room for event', {
			e : event,
			r : roomId,
		});
		return;
	}
	
	room.toRoom( event );
}

ns.Rooms.prototype.handleRoomClosed = function( roomId ) {
	const self = this;
	self.remove( roomId );
	self.emit( 'close', roomId );
}

module.exports = ns.Account;
