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

const log = require( './Log')( 'RoomCtrl' );
const uuid = require( './UuidPrefix' )( 'room' );
const ContactRoom = require( './RoomContact' );
const Emitter = require( './Events' ).Emitter;
const dFace = require( './DFace' );
const Room = require( './Room' );
const tiny = require( './TinyAvatar' );

const util = require( 'util' );

var ns = {};
ns.RoomCtrl = function( dbPool, idCache, worgs ) {
	const self = this;
	
	Emitter.call( self );
	
	self.dbPool = dbPool;
	self.idCache = idCache;
	self.worgs = worgs;
	self.roomDb = null;
	self.accDb = null;
	
	self.rooms = {};
	self.roomIds = [];
	self.roomLoads = {};
	
	self.relations = {};
	self.relationIds = [];
	self.relationLoads = {};
	
	self.init();
}

util.inherits( ns.RoomCtrl, Emitter );

// Public

ns.RoomCtrl.prototype.checkActive = function( roomId ) {
	const self = this;
	return !!self.rooms[ roomId ];
}

ns.RoomCtrl.prototype.connectContact = async function( accId, contactId ) {
	const self = this;
	if ( accId === contactId )
		return null;
	
	let room = null;
	try {
		room = await self.getContactRoom( accId, contactId );
	} catch( e ) {
		log( 'connectContact - failed to get room', e );
		return null;
	}
	
	if ( !room )
		return null;
	
	const user = await room.connect( accId );
	if ( !user )
		return null;
	
	const join = {
		type : 'contact-join',
		data : null,
	};
	self.emit( contactId, join, accId );
	return user;
}

ns.RoomCtrl.prototype.createRoom = async function( accountId, conf ) {
	const self = this;
	conf = conf || {};
	if ( null == conf.name )
		return await self.createAnonRoom( accountId );
	else
		return await self.createNamedRoom( accountId, conf );
}

ns.RoomCtrl.prototype.joinRoom = async function( accountId, conf ) {
	const self = this;
	if ( conf.token )
		return await self.joinWithInvite( accountId, conf );
	else
		return await self.joinWithAuth( accountId, conf );
}

ns.RoomCtrl.prototype.authorizeGuestInvite = async function( bundle ) {
	const self = this;
	const token = bundle.token;
	const roomId = bundle.roomId;
	const room = self.rooms[ roomId ];
	if ( room )
		return await authWithRoom( token, room );
	else
		return await authWithDb( token, roomId );
	
	async function authWithDb( token, roomId ) {
		const dbToken = await self.invDb.checkForRoom( token, roomId );
		if ( !dbToken || !dbToken.isValid )
			return false;
			
		if ( !!dbToken.singleUse )
			await self.invDb.invalidate( token );
		
		return roomId;
	}
	
	async function authWithRoom( token, room ) {
		const isValid = await room.authenticateInvite( token )
		if ( isValid )
			return roomId;
		else
			return false;
	}
}

ns.RoomCtrl.prototype.guestJoinRoom = async function( accountId, roomId ) {
	const self = this;
	let acc = await self.idCache.get( accountId );
	if ( !acc )
		return null;
	
	let room = null;
	try {
		room = await self.getRoom( roomId );
	} catch( err ) {
		log( 'guestJoinRoom - getRoom err', err );
		return null;
	}
	
	if ( !room )
		return null;
	
	let user = null;
	user = await room.connect( accountId );
	return user || null;
}

ns.RoomCtrl.prototype.connectWorkgroup = async function( accountId, roomId ) {
	const self = this;
	let room = null;
	try {
		room = await self.getRoom( roomId );
	} catch( err ) {
		log( 'workgroupJoinRoom - getRoom err', err.stack || err );
		return null;
	}
	
	if ( !room )
		return null;
	
	let user = null;
	user = await room.connect( accountId );
	return user;
}

// go online in a room  - the room will start sending events to this client
// only an authorized user can .connect directly
ns.RoomCtrl.prototype.connect = async function( accountId, roomId ) {
	const self = this;
	let room = null;
	try {
		room = await self.getRoom( roomId );
	} catch( err ) {
		log( 'connect - error loading room', err );
		return null;
	}
	
	if ( !room )
		return null;
	
	const user = await room.connect( accountId );
	if ( !user )
		return null;
	
	return user;
}

// closes roomCtrl, not a room
ns.RoomCtrl.prototype.close = function() {
	const self = this;
	if ( self.roomDb )
		self.roomDb.close();
	
	if ( self.accDb )
		self.accDb.close();
	
	if ( self.invDb )
		self.invDb.close();
	
	// TODO : close rooms
	
	delete self.idCache;
	delete self.worgs;
	delete self.roomDb;
	delete self.accDb;
	delete self.invDb;
	delete self.dbPool;
}

// Private

ns.RoomCtrl.prototype.init = async function() {
	const self = this;
	log( 'room ctrl init =^y^=' );
	self.roomDb = new dFace.RoomDB( self.dbPool );
	self.accDb = new dFace.AccountDB( self.dbPool );
	self.invDb = new dFace.InviteDB( self.dbPool );
	
	try {
		self.guestAvatar = await tiny.generateGuest( 'roundel' );
	} catch ( err ) {
		self.guestAvatar = null;
		log( 'init - failed to generate guest avatar', err );
	}
}

ns.RoomCtrl.prototype.createNamedRoom = function( accId, conf ) {
	const self = this;
	log( 'createNamedRoom - NYI', conf );
}

ns.RoomCtrl.prototype.createAnonRoom = async function( accId ) {
	const self = this;
	const ownerId = accId;
	const roomId = uuid.get();
	const acc = await self.idCache.get( accId );
	let room = null;
	const roomConf = {
		clientId   : roomId,
		ownerId    : ownerId,
		name       : '[ temp ] created by: ' + acc.name,
	};
	
	room = await self.setRoom( roomConf );
	if ( !room )
		return null;
	
	const user = await room.connect( accId );
	return user;
}

ns.RoomCtrl.prototype.joinWithInvite = async function( accountId, conf ) {
	const self = this;
	const rid = conf.roomId;
	const room = await self.getRoom( rid );
	if ( !room )
		return null;
	
	const isValid = await room.authenticateInvite( conf.token )
	if ( !isValid ) {
		log( 'ERR_INVITE_INVALID', conf );
		return false;
	}
	
	const authed = await self.authorizeForRoom( accountId, rid );
	const user = await room.connect( accountId );
	return user;
}

ns.RoomCtrl.prototype.joinWithAuth = async function( accountId, conf ) {
	const self = this;
	log( 'joinWithauth', 'ERR_NYI_FUCKO' );
	return false;
}

ns.RoomCtrl.prototype.setRoom = function( roomConf ) {
	const self = this;
	const roomId = roomConf.clientId;
	const isContactRoom = checkIsContactRoom( roomConf.ownerId );
	if ( isContactRoom )
		return new Promise( openContactRoom );
	else
		return new Promise( openRoom );
	
	function openContactRoom( resolve, reject ) {
		const roomId = roomConf.clientId;
		const room = new ContactRoom(
			roomConf,
			self.dbPool,
			self.idCache,
		);
		
		room.once( 'open', onOpen );
		self.bindContactRoom( room );
		
		function onOpen() {
			self.rooms[ roomId ] = room;
			self.roomIds = Object.keys( self.rooms );
			resolve( self.rooms[ roomId ]);
		}
	}
	
	function openRoom( resolve, reject ) {
		roomConf.guestAvatar = self.guestAvatar;
		const roomId = roomConf.clientId;
		const room = new Room(
			roomConf,
			self.dbPool,
			self.idCache,
			self.worgs
		);
		
		room.once( 'open', onOpen );
		self.bindRoom( room );
		
		function onOpen() {
			self.rooms[ roomId ] = room;
			self.roomIds = Object.keys( self.rooms );
			resolve( self.rooms[ roomId ]);
		}
	}
	
	function checkIsContactRoom( ownerId ) {
		return !!self.relations[ ownerId ];
	}
}

ns.RoomCtrl.prototype.bindRoom = function( room ) {
	const self = this;
	let roomId = room.id;
	room.on( 'empty', onEmpty );
	room.on( 'workgroup-assigned', worgAss );
	room.on( 'workgroup-dismissed', worgDiss );
	
	function onEmpty( e ) { self.removeRoom( roomId ); }
	function worgAss( e ) { self.handleWorkgroupAssigned( e, roomId ); }
	function worgDiss( e ) {  }
}

ns.RoomCtrl.prototype.bindContactRoom = function( room ) {
	const self = this;
	let rId = room.id;
	room.on( 'empty', onEmpty );
	room.on( 'contact-event', contactEvent );
	
	function onEmpty( e ) { self.removeRoom( rId ); }
	function contactEvent( e ) { self.forwardContactEvent( e, rId ); }
}

ns.RoomCtrl.prototype.handleWorkgroupAssigned = function( worg, roomId ) {
	const self = this;
	const userList = self.worgs.getUserList( worg.cId );
	const join = {
		type : 'workgroup-join',
		data : null,
	};
	userList.forEach( accId => {
		self.emit( accId, join, roomId );
	});
}

ns.RoomCtrl.prototype.forwardContactEvent = function( event, roomId ) {
	const self = this;
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

ns.RoomCtrl.prototype.getRoom = async function( rid ) {
	const self = this;
	let room = self.rooms[ rid ];
	if ( room )
		return room;
	
	let loader = self.roomLoads[ rid ];
	if ( loader ) {
		room = await loadDone( loader );
		return room || null;
	}
	
	loader = loadRoom( rid );
	self.roomLoads[ rid ] = loader;
	room = await loadDone( loader );
	return room || null;
	
	async function loadDone( loader ) {
		return new Promise(( resolve, reject ) => {
			loader
				.then( loadingLoaded )
				.catch( loadingErr );
			
			function loadingLoaded( room ) {
				resolve( room );
			}
			
			function loadingErr( err ) {
				log( 'getRoom - failed to load', err.stack || err );
				reject( null );
			}
		});
	}
	
	async function loadRoom( rid ) {
		let roomConf = null;
		try {
			roomConf = await self.roomDb.get( rid );
		} catch( err ) {
			log( 'getRoom - db load err', err.stack || err );
			return null;
		}
		
		if ( !roomConf )
			return null;
		
		if ( !roomConf.avatar )
			roomConf.avatar = await tiny.generate( roomConf.name, 'block' );
		
		roomConf.persistent = true;
		let room = null;
		try {
			room = await self.setRoom( roomConf );
		} catch( err ) {
			log( 'getRoom - setRoom failed', err.stack || err );
			return null;
		}
		
		delete self.roomLoads[ rid ];
		if ( !room )
			return null;
		
		return room;
	}
}

ns.RoomCtrl.prototype.removeRoom = function( rid ) {
	const self = this;
	const room = self.rooms[ rid ];
	if ( !room )
		return;
	
	room.close( closeBack );
	function closeBack() {
		delete self.rooms[ rid ];
		self.roomIds = Object.keys( self.rooms );
	}
}

ns.RoomCtrl.prototype.getContactRoom = async function( accId, contactId ) {
	const self = this;
	let room = null;
	let relation = null;
	let contact = await self.idCache.get( contactId );
	if ( !contact ) {
		log( 'getContactRoom - no identity found for', contactId );
		return null;
	}
	
	relation = await self.getRelation( accId, contactId );
	if ( !relation )
		relation = await self.setRelation( accId, contactId );
	
	if ( !relation )
		return null;
	
	if ( relation.roomId )
		room = await loadRoom( relation.roomId );
	else
		room = await createRoom( relation.clientId, accId, contactId );
	
	return room;
	
	async function loadRoom( roomId ) {
		let room = await self.getRoom( roomId );
		if ( !room )
			return null;
		
		return room;
	}
	
	async function createRoom( relationId, accId, contactId ) {
		const relation = self.relations[ relationId ];
		let room = null;
		let roomId = null;
		try {
			roomId = await self.createContactRoom( relationId );
		} catch( e ) {
			log( 'e', e );
		}
		if ( !roomId )
			return null;
		
		relation.roomId = roomId;
		room = await self.getRoom( roomId );
		if ( !room )
			return null;
		
		await room.setRelation( relation );
		return room;
	}
}

ns.RoomCtrl.prototype.createContactRoom = async function( relationId ) {
	const self = this;
	const roomId = uuid.get( 'cont' );
	let roomConf = null;
	try {
		roomConf = await self.roomDb.set(
			roomId,
			'contact-room',
			relationId,
			true,
		);
	} catch ( e ) {
		log( 'createContactRoom - db failed to create', e.stack || e );
		return null;
	}
	
	if ( !roomConf )
		return null;
	
	try {
		await self.roomDb.assignRelationRoom( relationId, roomId );
	} catch( e ) {
		log( 'createContactRoom - assignRelationRoom failed', e.stack || e );
		// TODO : DESTROY ROOM / FLAG ?
		return null;
	}
	
	return roomConf.clientId;
}

ns.RoomCtrl.prototype.setRelation = async function( accIdA, accIdB ) {
	const self = this;
	let relation = null;
	try {
		relation = await self.roomDb.setRelation( accIdA, accIdB );
	} catch( e ) {
		log( 'setRelation - db err setting realtion', {
			accA : accIdA,
			accB : accIdB,
			err  : e.stack || e,
		});
		return null;
	}
	
	if ( !relation ) {
		log( 'setRelation - failed to set realtion for', {
			a : accIdA,
			b : accIdB,
		});
		return null;
	}
	
	self.relations[ relation.clientId ] = relation;
	self.relationIds = Object.keys( self.relations );
	return relation;
}

ns.RoomCtrl.prototype.getRelation = async function( accIdA, accIdB ) {
	const self = this;
	let relation;
	try {
		relation = await self.roomDb.getRelation( accIdA, accIdB );
	} catch( e ) {
		log( 'getRelation - db.getRelation failed', e.stack || e );
		return null;
	}
	
	if ( !relation )
		return null;
	
	self.relations[ relation.clientId ] = relation;
	self.relationIds = Object.keys( self.relations );
	return relation || null;
}

// account

// use for real users
// dont use this for guests ( they dont have a real account anyway so will fail )
ns.RoomCtrl.prototype.authorizeForRoom = async function( accId, roomId ) {
	const self = this;
	const room = self.rooms[ roomId ];
	if ( !room )
		return false;
	
	const ok = await room.authorizeUser( accId );
	return true;
}

ns.RoomCtrl.prototype.removeFromRoom = function( accountId, roomId ) {
	const self = this;
	log( 'removeFromRoom - NYI', accountId );
}


module.exports = ns.RoomCtrl;
