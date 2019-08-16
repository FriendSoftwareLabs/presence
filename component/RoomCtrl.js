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
const WorkRoom = require( './RoomWork' );
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
	
	self.workRooms = {};
	self.workRoomIds = [];
	
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

ns.RoomCtrl.prototype.getWorkRooms = function( accountId ) {
	const self = this;
	const rooms = {};
	const worgs = self.worgs.getMemberOf( accountId );
	let member = worgs.filter( wId => {
		return !!self.workRooms[ wId ];
	});
	let subs = null;
	let views = null;
	if ( global.config.server.workroom.supersHaveSubRoom )
		subs = getSubs( member );
	
	if ( global.config.server.workroom.subsHaveSuperView )
		views = getViews( member );
	
	const works = [ ...member, ...subs ];
	rooms.works = works.map( getRoomInfo );
	rooms.views = views.filter( vId => {
		return !works.some( wId => wId === vId );
	}).map( getRoomInfo );
	
	return rooms;
	
	function getSubs( works ) {
		let add = null;
		works.forEach( wId => {
			const subs = self.worgs.getSuperChildren( wId );
			add = subs.filter( sId => {
				return !!self.workRooms[ sId ];
			});
		});
		return add || [];
	}
	
	function getViews( works ) {
		const viewMap = {};
		works.forEach( wId => {
			const room = self.getWorkRoom( wId );
			const superId = room.getSuperId();
			if ( !superId )
				return;
			
			viewMap[ superId ] = true;
		});
		return Object.keys( viewMap ) || [];
	}
	
	function getRoomInfo( wId ) {
		const room = self.workRooms[ wId ];
		return {
			worgId   : wId,
			clientId : room.id
		};
	}
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

ns.RoomCtrl.prototype.rejectInvite = function( accountId, inv ) {
	const self = this;
	log( 'rejectInvite', inv );
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

ns.RoomCtrl.prototype.connectWorkRoom = async function( accountId, workgroupId ) {
	const self = this;
	const room = self.getWorkRoom( workgroupId );
	if ( !room )
		return null;
	
	const user = await room.connect( accountId );
	return user;
}

// allows a user from a sub room to have a view into a parent room
ns.RoomCtrl.prototype.connectWorkView = async function( accountId, workgroupId ) {
	const self = this;
	const room = self.getWorkRoom( workgroupId );
	if ( !room )
		return null;
	
	const user = await room.connectViewer( accountId );
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
	// TODO : close rooms
	
	if ( self.roomDb )
		self.roomDb.close();
	
	if ( self.accDb )
		self.accDb.close();
	
	if ( self.invDb )
		self.invDb.close();
	
	if ( self.worgs ) {
		self.worgs.release( 'super-added' );
		self.worgs.release( 'super-removed' );
		self.worgs.release( 'sub-added' );
		self.worgs.release( 'sub-removed' );
	}
	
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
	
	self.worgs.on( 'users-added', ( wId, users ) => self.handleWorkgroupUserAdds( wId, users ));
	self.worgs.on( 'users-removed', ( wId, users ) => self.handleWorkgroupUserRemoved( wId, users ));
	self.worgs.on( 'super-added', ( s, c ) => self.superAdded( s, c ));
	self.worgs.on( 'super-removed', ( s, c ) => self.superRemoved( s, c ));
	self.worgs.on( 'sub-added', ( c, s ) => self.subAdded( c, s ));
	self.worgs.on( 'sub-removed', ( c, s ) => self.subRemoved( c, s ));
}

ns.RoomCtrl.prototype.superAdded = async function( worgId, subs ) {
	const self = this;
	// create room for super or update existing child
	let wRoom = self.getWorkRoom( worgId );
	if ( wRoom ) {
		log( 'superAdded - room already open', {
			worgId : worgId,
			wRooms : self.workRooms,
		});
		return;
	}
	/*
	if ( wRoom ) {
		updateSubs( worgId, subs );
		return;
	}
	*/
	
	wRoom = await self.setWorkRoom( worgId, 2 );
	if ( !wRoom )
		return null;
	
	
	if ( subs )
		await Promise.all( subs.map( await openSub ));
	
	await Promise.all( subs.map( connect ));
	
	/*
	const members = self.worgs.getUserList( worgId );
	log( 'superAdded - members', members );
	self.addUsersToWorkRooms( worgId, members );
	*/
	
	const parentId = self.worgs.getSuperParent( worgId );
	if ( !parentId )
		return;
	
	const parent = self.getWorkRoom( parentId );
	if ( !parent )
		return;
	
	wRoom.setSuper( parent );
	
	function updateSubs( worgId, subs ) {
		log( 'updateSubs - NYI', {
			super : worgId,
			subs  : subs,
		});
	}
	
	async function openSub( subId ) {
		let sub = self.getWorkRoom( subId );
		if ( sub )
			return;
		
		await self.setWorkRoom( subId, 4 );
	}
	
	async function connect( subId ) {
		let sup = self.getWorkRoom( worgId );
		let sub = self.getWorkRoom( subId );
		await sup.attach( sub );
		sub.setSuper( sup );
	}
}

ns.RoomCtrl.prototype.superRemoved = async function( superId, children ) {
	const self = this;
	// release
	self.closeWorkRoom( superId, children );
}

ns.RoomCtrl.prototype.subAdded = async function( childId, superId ) {
	const self = this;
	const sup = self.getWorkRoom( superId );
	if ( !sup ) {
		log( 'subAdded - could not find super', {
			subId : childId,
			superId : superId,
		});
		return;
	}
	
	let sub = self.getWorkRoom( childId )
	if ( !sub )
		sub = await self.setWorkRoom( childId, 4 );
	
	if ( !sub ) {
		log( 'subAdded - still no sub room', sub );
		return;
	}
	
	await sup.attach( sub );
	sub.setSuper( sup );
}

ns.RoomCtrl.prototype.subRemoved = async function( subId, superId ) {
	const self = this;
	const isSuper = self.worgs.checkIsSuper( subId );
	if ( isSuper )
		self.detachSub( subId, superId );
	else
		self.closeWorkRoom( subId );
}

ns.RoomCtrl.prototype.detachSub = function( childId ) {
	const self = this;
	let sub = self.getWorkRoom( childId );
	const superId = sub.getSuperId();
	if ( !superId )
		return;
	
	let sup = self.getWorkRoom( superId );
	if ( !sup || !sub ) {
		log( 'detachSub - could not find', {
			supId : superId,
			subId : childId,
			sup   : !!sup,
			sub   : !!sub,
			wroom : self.workRooms,
		});
		return;
	}
	
	sup.detach( childId );
	sub.unsetSuper();
	
	// remove child or update existing super
}

ns.RoomCtrl.prototype.setWorkRoom = async function( worgId, priority ) {
	const self = this;
	const worg = self.worgs.get( worgId );
	if ( !worg ) {
		log( 'setWorkRoom - no worg for', worgId );
		return;
	}
	
	let supConf = await self.roomDb.getForWorkgroup( worgId );
	if ( !supConf )
		supConf = await self.createWorkRoom( worgId );
	
	if ( !supConf )
		return null;
	
	supConf.avatar = await tiny.generate( worg.name, 'block' );
	supConf.name = worg.name;
	supConf.priority = priority;
	
	const superId = await openRoom( worgId, supConf );
	if ( superId !== worgId )
		throw new Error( 'wft - ids not matching, wId: '
		 + worgId + ', sId: ' + superId );
	
	const room = self.getWorkRoom( worgId );
	return room;
	
	function openRoom( worgId, conf ) {
		return new Promise(( resolve, reject ) => {
			let roomId = conf.workgroupId;
			let room = new WorkRoom(
				supConf,
				self.dbPool,
				self.idCache,
				self.worgs
			);
			
			room.once( 'open', onOpen );
			room.on( 'join-work', e => self.handleWorkRoomJoin( e, worgId ));
			room.on( 'join-view', e => self.handleWorkViewJoin( e, worgId ));
			
			async function onOpen() {
				self.workRooms[ roomId ] = room;
				await self.addUsersToWorkRooms( worgId );
				resolve( roomId );
			}
		});
	}
}

ns.RoomCtrl.prototype.closeWorkRoom = async function( worgId, children ) {
	const self = this;
	const sRoom = self.workRooms[ worgId ];
	if ( !sRoom )
		return false;
	
	children = children || self.worgs.getSuperChildren( worgId );
	await Promise.all( children.map( release ));
	
	// detach from super if child
	if ( sRoom.isChild())
		self.detachSub( worgId );
	
	delete self.workRooms[ worgId ];
	sRoom.release();
	sRoom.close();
	return true;
	
	//
	async function release( subId ) {
		sRoom.detach( subId );
		const sub = self.getWorkRoom( subId );
		if ( !sub )
			return;
		
		sub.unsetSuper();
		const isSuper = self.worgs.checkIsSuper( subId );
		if ( isSuper )
			return;
		
		await self.closeWorkRoom( worgId );
	}
}

ns.RoomCtrl.prototype.createWorkRoom = async function( worgId ) {
	const self = this;
	let worg = self.worgs.get( worgId );
	let roomConf = await self.roomDb.setForWorkgroup(
		worgId,
		worg.name
	);
	return roomConf;
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
	const rId = conf.roomId;
	const room = await self.getRoom( rId );
	if ( !room )
		return null;
	
	const isValid = await room.authenticateInvite( conf.token, accountId );
	if ( !isValid ) {
		log( 'ERR_INVITE_INVALID', conf );
		return false;
	}
	
	const authed = await self.authorizeForRoom( accountId, rId );
	if ( !authed )
		return null;
	
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
	const roomId = room.id;
	room.on( 'empty', e => self.removeRoom( roomId ));
	room.on( 'invite-add', e => self.handleInviteAdd( e, roomId ));
	room.on( 'workgroup-assigned', e => self.handleWorkgroupAssigned( e, roomId ));
	room.on( 'workgroup-dismissed', e => {});
}

ns.RoomCtrl.prototype.bindContactRoom = function( room ) {
	const self = this;
	let rId = room.id;
	room.on( 'empty', onEmpty );
	room.on( 'contact-event', contactEvent );
	
	function onEmpty( e ) { self.removeRoom( rId ); }
	function contactEvent( e ) { self.forwardContactEvent( e, rId ); }
}

ns.RoomCtrl.prototype.handleInviteAdd = function( event, roomId ) {
	const self = this;
	const room = self.rooms[ roomId ];
	const info = room.getInfo();
	event.room = info;
	const userId = event.targetId;
	const inv = {
		type : 'invite-add',
		data : event,
	};
	self.emit( userId, inv, roomId );
}

ns.RoomCtrl.prototype.handleWorkgroupAssigned = async function( worg, roomId ) {
	const self = this;
	const worgId = worg.cId;
	const userList = self.worgs.getUserList( worgId );
	const room = await self.getRoom( roomId );
	await room.addUsers( userList, worgId );
	self.sendWorgJoin( roomId, userList );
}

ns.RoomCtrl.prototype.handleWorkgroupUserAdds = async function( worgId, userList ) {
	const self = this;
	const fId = self.worgs.cIdToFId( worgId );
	const roomIds = await self.roomDb.getAssignedTo( fId );
	const wRoom = self.getWorkRoom( worgId );
	if ( roomIds || roomIds.length )
		await Promise.all( roomIds.map( addToRoom ));
	
	if ( !wRoom )
		return;
	
	self.addUsersToWorkRooms( worgId, userList );
	
	async function addToRoom( rId ) {
		const room = self.rooms[ rId ];
		if ( room )
			await room.addUsers( userList, worgId );
		
		self.sendWorgJoin( rId, userList );
	};
}

ns.RoomCtrl.prototype.handleWorkgroupUserRemoved = async function( worgId, userList ) {
	const self = this;
	self.removeUsersFromWorkRooms( worgId, userList );
}

ns.RoomCtrl.prototype.handleWorkRoomJoin = function( e, roomId ) {
	const self = this;
	log( 'handleWorkRoomJoin - NYI', roomId );
}

ns.RoomCtrl.prototype.handleWorkViewJoin = function( joinList, workId ) {
	const self = this;
	const room = self.getWorkRoom( workId );
	self.sendWorkViewJoin( room.id, workId, joinList );
}

ns.RoomCtrl.prototype.sendWorgJoin = function( roomId, userList ) {
	const self = this;
	if ( !userList || !userList.length )
		return;
	
	const join = {
		type : 'workgroup-join',
		data : null,
	};
	userList.forEach( userId => {
		self.emit( userId, join, roomId );
	});
}

ns.RoomCtrl.prototype.addUsersToWorkRooms = async function( worgId, userList ) {
	const self = this;
	if ( !userList )
		userList = self.worgs.getUserList( worgId );
	
	const wRoom = self.getWorkRoom( worgId );
	if ( !wRoom ) {
		log( 'addUsersToWorkRoom - no room for', worgId );
		return;
	}
	
	if ( userList && userList.length )
		await wRoom.addUsers( userList, worgId );
	
	const roomId = wRoom.id;
	sendJoin( userList, worgId, roomId );
	
	if ( global.config.server.workroom.subsHaveSuperView )
		await addToSuperView( worgId, userList );
	
	if ( global.config.server.workroom.supersHaveSubRoom ) {
		await addFromSuper( worgId );
		await addToSubRoom( worgId, userList );
	}
	
	async function addToSuperView( worgId, uList ) {
		if ( !uList || !uList.length )
			return;
		
		const wParent = self.worgs.getSuperParent( worgId );
		if ( !wParent ) {
			return;
		}
		
		const pRoom = self.getWorkRoom( wParent );
		if ( !pRoom )
			return;
		
		await pRoom.addViewers( uList, worgId );
	}
	
	async function addToSubRoom( worgId, uList ) {
		if ( !uList || !uList.length )
			return;
		
		const subs = self.worgs.getSuperChildren( worgId );
		if ( !subs || !subs.length )
			return;
		
		await Promise.all( subs.map( async subId => {
			const sRoom = self.getWorkRoom( subId );
			if ( !sRoom ) {
				return;
			}
			
			await sRoom.addUsers( uList, worgId );
			sendJoin( uList, subId, sRoom.id );
		}));
	}
	
	async function addFromSuper( worgId ) {
		const parentId = self.worgs.getSuperParent( worgId );
		const wRoom = self.getWorkRoom( worgId );
		const pRoom = self.getWorkRoom( parentId );
		if ( !pRoom )
			return;
		
		const members = self.worgs.getUserList( parentId );
		await wRoom.addUsers( members, parentId );
		sendJoin( members, worgId, wRoom.id );
	}
	
	function sendJoin( userList, worgId, roomId ) {
		const join = {
			type : 'workroom-join',
			data : worgId,
		};
		userList.forEach( uId => {
			self.emit( uId, join, roomId );
		});
	}
}

ns.RoomCtrl.prototype.sendWorkViewJoin = function( roomId, worgId, userList ) {
	const self = this;
	if ( !userList || !userList.length )
		return;
	
	const join = {
		type : 'workroom-view',
		data : worgId,
	};
	userList.forEach( uId => {
		self.emit( uId, join, roomId );
	});
}

ns.RoomCtrl.prototype.removeUsersFromWorkRooms = async function( worgId, userList ) {
	const self = this;
	if ( !userList || !userList.length )
		return;
	
	const wRoom = self.getWorkRoom( worgId );
	if ( !wRoom )
		return;
	
	await wRoom.removeUsers( userList, worgId );
	
	if ( global.config.server.workroom.subsHaveSuperView )
		await removeFromSuperView( worgId, userList );
	
	if ( global.config.server.workroom.supersHaveSubRoom )
		removeFromSubRoom( worgId, userList );
	
	async function removeFromSuperView( worgId, uList ) {
		const superId = self.worgs.getSuperParent( worgId );
		if ( !superId )
			return;
		
		const pRoom = self.getWorkRoom( superId );
		if ( !pRoom )
			return;
		
		await pRoom.removeUsers( uList, worgId );
	}
	
	function removeFromSubRoom( worgId, uList ) {
		const subs = self.worgs.getSuperChildren( worgId );
		if ( !subs || !subs.length )
			return;
		
		subs.forEach( subId => {
			sRoom = self.getWorkRoom( subId );
			if ( !sRoom )
				return;
			
			sRoom.removeUsers( userList, worgId );
		});
		
		function notInMembers( uId ) {
			return !members.some( mId => mId === uId );
		};
	}
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
	
	room.close();
	delete self.rooms[ rid ];
	self.roomIds = Object.keys( self.rooms );
}

ns.RoomCtrl.prototype.getWorkRoom = function( worgId ) {
	const self = this;
	let room = self.workRooms[ worgId ];
	return room || null;
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
	log( 'authForroom', ok );
	return ok;
}

ns.RoomCtrl.prototype.removeFromRoom = function( accountId, roomId ) {
	const self = this;
	log( 'removeFromRoom - NYI', accountId );
}


module.exports = ns.RoomCtrl;
