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

'use strict';

const events = require( './Events' );
const dFace = require( './DFace' );
const uuid = require( './UuidPrefix' )( '' );
const util = require( 'util' );

var ns = {};

/*
	ACCOUNT CONSTRUCTOR RETURNS A PROMISE
	dealwithit.jpg
*/
ns.Account = function(
	session,
	clientId,
	dbPool,
	idCache,
	roomCtrl,
	worgCtrl,
) {
	const self = this;
	self.id = clientId;
	self.session = session;
	self.dbPool = dbPool;
	self.idCache = idCache;
	self.roomCtrl = roomCtrl;
	self.worgCtrl = worgCtrl;
	
	self.settings = {};
	self.rooms = null;
	self.connecting = {};
	self.IdsInUse = {};
	self.contacts = {};
	self.contactIds = [];
	self.hidden = {};
	self.relations = {};
	self.relationIds = [];
	
	return new Promise(( resolve, reject ) => {
		self.init()
			.then( initDone )
			.catch( initOpps );
		
		function initDone() {
			resolve( self );
		}
		
		function initOpps( err ) {
			console.log( 'Account - initOpps', err );
			resolve( null );
		}
	});
}

// Public

ns.Account.prototype.close = function() {
	const self = this;
	self.closed = true;
	self.clearAllSorted();
	self.logout( outBack );
	function outBack() {
		delete self.dbPool;
		delete self.idCache;
		delete self.roomCtrl;
		delete self.worgCtrl;
		delete self.onclose;
		delete self.contacts;
		delete self.contactIds;
		delete self.relations;
	}
}

ns.Account.prototype.getId = function() {
	const self = this;
	return self.identity;
}

ns.Account.prototype.getWorkgroups = function() {
	const self = this;
	if ( !self.worgCtrl )
		return null;
	
	return self.worgCtrl.get( self.id );
}

ns.Account.prototype.getContactList = function() {
	const self = this;
	return self.contactIds;
}

ns.Account.prototype.addContacts = async function( contactList ) {
	const self = this;
	await Promise.all( contactList.map( id => self.addContact( id )));
}

ns.Account.prototype.addContact = async function( accId ) {
	const self = this;
	if ( accId === self.id )
		return false;
	
	if ( self.contacts[ accId ])
		return accId;
	
	//self.rooms.listen( accId, contactEvent );
	self.contacts[ accId ] = accId;
	self.contactIds.push( accId );
	
	if ( !self.isLoaded )
		return accId;
	
	const contact = {
		clientId : accId,
	};
	
	const cAdd = {
		type : 'contact-add',
		data : contact,
	};
	self.conn.send( cAdd );
	
	return accId;
	
	/*
	function contactEvent( event ) {
		let contactId = accId;
		self.handleContactListen( event, contactId );
	}
	*/
}

ns.Account.prototype.updateWorkgroup = function( update ) {
	const self = this
	self.conn.send( update )
}

ns.Account.prototype.updateContacts = function() {
	const self = this
	self.log( 'updateContacts- NOOP' )
}

ns.Account.prototype.updateWorkgroupContacts = function() {
	const self = this
	const cList = self.worgCtrl.getContactList( self.id, true )
	self.log( 'updateWorkgroupContacts', cList )
	const cMap = {}
	cList.forEach( accId => {
		cMap[ accId ] = true
		self.addContact( accId )
	})
	const removed = self.contactIds.filter( notInList )
	removed.forEach( accId => self.removeContact( accId ))
	
	function notInList( currId ) {
		return !cMap[ currId ]
	}
}

ns.Account.prototype.removeContact = function( contactId ) {
	const self = this;
	if ( !self.contacts[ contactId ])
		return;
	
	//self.rooms.remove( contactId );
	delete self.contacts[ contactId ];
	self.contactIds = Object.keys( self.contacts );
	if ( !self.isLoaded )
		return contactId;
	
	const cRemove = {
		type : 'contact-remove',
		data : contactId,
	};
	self.conn.send( cRemove );
}

ns.Account.prototype.updateContactStatus = function( type, contactId, data ) {
	const self = this;
	self.log( 'updateContactStatus - NOOP', [
		type,
		contactId,
		data,
	]);
	return;
	
	if ( !self.IdsInUse[ contactId ])
		return;
	
	const event = {
		clientId : contactId,
		data     : data,
	};
	
	self.sendContactEvent( type, event );
}


ns.Account.prototype.addRelation = async function( conId ) {
	const self = this;
	let rel = self.relations[ conId ];
	if ( null != rel )
		return;
	
	rel = await self.roomCtrl.getRelation( self.id, conId );
	if ( null == rel )
		throw 'ERR_COULD_NOT_RELATE';
	
	self.registerRelation( rel );
	
	return conId;
}

ns.Account.prototype.removeRelation = async function( conId ) {
	const self = this;
	if ( !self.relations[ conId ])
		return;
	
	delete self.relations[ conId ];
	self.relationIds = Object.keys( self.relations );
	
	const cRemove = {
		type : 'relation-remove',
		data : conId,
	};
	self.conn.send( cRemove );
}

ns.Account.prototype.updateIdentity = async function( event ) {
	const self = this;
	if ( self.closed )
		return;
	
	const cId = event.clientId;
	const clientNeedsUpdate = !!self.IdsInUse[ cId ];
	if ( !clientNeedsUpdate )
		return;
	
	if ( 'fIsDisabled' == event.key ) {
		self.handleDisableChange( event );
		return;
	}
	
	const update = {
		type : 'identity-update',
		data : event,
	};
	self.conn.send( update );
}

ns.Account.prototype.invalidateANCache = function() {
	const self = this;
	self.clearAllSorted();
}

// Private

ns.Account.prototype.init = async function() {
	const self = this;
	await self.setIdentity();
	self.setLogger();
	self.bindRoomCtrl();
	self.bindContactEvents();
	self.bindConn();
	self.setupRooms();
	self.bindIdRequests();
	await self.loadRelations();
	await self.loadContacts();
	
	return true;
}

ns.Account.prototype.setLogger = function() {
	const self = this;
	const logStr = 'Account-' + self.identity.name;
	self.log = require( './Log' )( logStr );
}

ns.Account.prototype.bindRoomCtrl = function() {
	const self = this;
	self.roomCtrl.on( self.id, roomCtrlEvent );
	self.roomCtrlEvents = {
		'room-join'      : rId => self.handleRoomJoin( rId ),
		'workroom-join'  : workRoomJoin,
		//'workroom-view'  : workRoomView,
		'workgroup-join' : workgroupJoin,
		'contact-active' : contactActive,
		'contact-event'  : contactRoomEvent,
		'invite-add'     : inviteAdd,
		'invite-remove'  : inviteRemove,
	};
	
	function roomCtrlEvent(    e, rid ) { self.handleRoomCtrlEvent(    e, rid ); }
	function workRoomJoin(     e, rid ) { self.handleWorkRoomJoin(     e, rid ); }
	//function workRoomView(     e, rid ) { self.handleWorkRoomView(     e, rid ); }
	function workgroupJoin(    e, rid ) { self.handleWorkgroupJoin(    e, rid ); }
	function contactActive(    e, rid ) { self.handleContactActive(    e, rid ); }
	function contactRoomEvent( e, rid ) { self.handleContactRoomEvent( e, rid ); }
	function inviteAdd(        e, rid ) { self.handleInviteAdd(        e, rid ); }
	function inviteRemove(     e, rid ) { self.handleInviteRemove(     e, rid ); }
}

ns.Account.prototype.bindContactEvents = function() {
	const self = this;
	self.clientContactEvents = {
		'open-chat' : openContactChat,
	};
	
	function openContactChat( e, cId ) { self.handleOpenContactChat( e, cId ); }
}

ns.Account.prototype.bindConn = function() {
	const self = this;
	self.conn = new events.RequestNode( self.id, self.session, accEventSink );
	self.conn.on( 'initialize', init );
	self.conn.on( 'settings', handleSettings );
	self.conn.on( 'room', handleRoomMsg );
	self.conn.on( 'room-get', getRoom );
	self.conn.on( 'room-join', joinRoom );
	self.conn.on( 'contact', handleContact );
	self.conn.on( 'contact-list', ( e, cId ) => self.handleContactList( e, cId ));
	self.conn.on( 'avatar', ( e, cId ) => self.handleAvatarEvent( e, cId ));
	self.conn.on( 'invite-response', ( e, cId ) => self.handleInviteResponse( e, cId ));
	self.conn.on( 'hidden-list', ( e, cId ) => self.handleHiddenList( e, cId ));
	self.conn.on( 'hidden-open', ( e, cId ) => self.handleHiddenOpen( e, cId ));
	self.conn.on( 'hidden-close', ( e, cId ) => self.handleHiddenClose( e, cId ));
	
	function accEventSink() {} //self.log( 'accEventSink', arguments, 3 ); }
	function init( e, cId ) { self.initializeClient( e, cId ); }
	function handleSettings( e, cId ) { self.handleSettings( e, cId ); }
	function handleRoomMsg( e, cId ) { self.log( 'roomMsg - noop', msg ); }
	function getRoom( e, cId ) { self.getRoom( e, cId ); }
	function joinRoom( e, cId ) { self.joinRoom( e, cId ); }
	function handleContact( e, cId ) { self.handleContactEvent( e, cId ); }
	
	// requests
	self.conn.on( 'friend-get'           , e => self.handleFriendGet( e ));
	self.conn.on( 'relation-add'         , e => self.handleAddRelation( e ));
	self.conn.on( 'search-user'          , e => self.handleSearchUser( e ));
	self.conn.on( 'account-settings-set' , e => self.handleAccSettingSet( e ));
	self.conn.on( 'room-create'          , e => self.handleRoomCreate( e ));
	
}

ns.Account.prototype.setupRooms = function() {
	const self = this;
	// rooms is a collection of chat rooms
	self.rooms = new ns.Rooms( self.conn );
	self.rooms.on( 'close', roomClosed );
	
	function roomClosed( e ) { self.handleRoomClosed( e ); }
}

ns.Account.prototype.bindIdRequests = function() {
	const self = this;
	self.idReq = new events.RequestNode( 'identity', self.conn, idSink );
	//self.idReq = new events.RequestNode( self.idNode );
	self.idReq.on( 'get', e => { return self.handleIdGet( e ); });
	self.idReq.on( 'get-list', e => { return self.handleIdList( e ); });
	self.idReq.on( 'refresh', e => { return self.handleIdRefresh( e ); });
	
	function idSink( ...args ) {
		self.log( 'idSink', args );
	}
}

ns.Account.prototype.handleIdGet = async function( clientId ) {
	const self = this;
	if ( !clientId || ( 'string' != typeof( clientId ))) {
		self.log( 'handleIdGet - invalid clientId', clientId );
		return null;
	}
	
	const id = await self.idCache.get( clientId );
	if ( null == id )
		return null;
	
	if ( null == id.workgroups )
		id.workgroups = self.worgCtrl.getMemberOf( clientId );
	
	self.IdsInUse[ clientId ] = true;
	return id;
}

ns.Account.prototype.handleIdList = async function( list ) {
	const self = this;
	const fetched = await self.idCache.getList( list );
	fetched.forEach( id => {
		let cId = id.clientId;
		if ( null == id.workgroups )
			id.workgroups = self.worgCtrl.getMemberOf( cId );
		
		self.IdsInUse[ cId ] = true;
	});
	
	return fetched;
}

ns.Account.prototype.handleIdRefresh = async function( timeMap ) {
	const self = this;
	const ids = Object.keys( timeMap );
	const idWaits = ids.map( cId => {
		return self.idCache.get( cId );
	});
	const idList = await Promise.all( idWaits );
	const updated = idList.filter( id => {
		if ( null == id )
			return false;
		
		const cId = id.clientId;
		const clientTime = timeMap[ cId ];
		const currTime = id.lastUpdate;
		if ( currTime !== clientTime )
			return true;
		else
			return false;
	});
	
	const withWorgs = updated.map( id => {
		const cId = id.clientId;
		id.workgroups = self.worgCtrl.getMemberOf( cId );
		self.IdsInUse[ cId ] = true;
		return id;
	});
	
	return withWorgs;
}

ns.Account.prototype.handleRoomCtrlEvent = function( event, roomId ) {
	const self = this;
	const handler = self.roomCtrlEvents[ event.type ];
	if ( !handler ) {
		self.log( 'handleRoomCtrlEvent - no handler for', [ event.type, event.data, roomId ]);
		return;
	}
	
	handler( event.data, roomId );
}

ns.Account.prototype.handleRoomJoin = async function( roomId ) {
	const self = this;
	const canConnect = self.doPreConnect( roomId );
	if ( !canConnect )
		return;
	
	let room = await self.roomCtrl.connect( self.id, roomId );
	if ( !room ) {
		self.clearConnecting( roomId );
		return;
	}
	
	await self.joinedARoomHooray( room );
}

ns.Account.prototype.handleWorkRoomJoin = async function( worgId, roomId ) {
	const self = this;
	const canConnect = self.doPreConnect( roomId );
	if ( !canConnect )
		return;
	
	let room = await self.roomCtrl.connectWorkRoom( self.id, worgId );
	if ( !room ) {
		//self.log( 'loadWorkRoom - could not connect to room', worgId );
		self.clearConnecting( roomId );
		return;
	}
	
	await self.joinedARoomHooray( room );
}

ns.Account.prototype.handleWorkgroupJoin = async function( event, roomId ) {
	const self = this;
	const canConnect = self.doPreConnect( roomId );
	if ( !canConnect )
		return;
	
	const room = await self.roomCtrl.connectWorkgroup( self.id, roomId );
	if ( !room ) {
		self.clearConnecting( roomId );
		return;
	}
	
	await self.joinedARoomHooray( room );
	return true;
}

ns.Account.prototype.handleContactActive = async function( event, contactId ) {
	const self = this;
	if ( self.closed )
		return;
	
	if ( !contactId )
		return;
	
	let room = self.rooms.get( contactId );
	if ( room ) {
		//sendOpen();
		return room;
	}
	
	room = await self.connectToContact( contactId );
	//sendOpen();
	
	return room;
	
	function sendOpen() {
		const open = {
			type : 'open',
			data : true,
		};
		room.send( open );
	}
}

ns.Account.prototype.connectToContact = async function( contactId ) {
	const self = this;
	let relation = self.relations[ contactId ];
	if ( null == relation ) {
		relation = await self.roomCtrl.getRelation( self.id, contactId );
		await self.registerRelation( relation );
	}
	
	let room = await self.roomCtrl.connectContact( self.id, contactId );
	if ( !room ) {
		self.log( 'connectToContact - failed to connect to room', contactId );
		try {
			throw Error( 'connectToContact trace' );
		} catch( ex ) {
			self.log( 'connectToContact - could not connect, trace', ex );
		}
		return null;
	}
	
	await self.joinedARoomHooray( room );
	
	return room;
}

ns.Account.prototype.handleContactRoomEvent = function( event, contactId ) {
	const self = this;
	self.log( 'handleContactRoomEvent - NYI', {
		e : event,
		r : contactId,
	});
	
}

ns.Account.prototype.handleInviteAdd = function( invite, roomId ) {
	const self = this;
	const room = self.rooms.get( roomId );
	if ( room ) {
		return;
	}
	
	invite.roomId = roomId;
	const inv = {
		type : 'invite',
		data : {
			type : 'add',
			data: invite,
		},
	};
	self.conn.send( inv );
}

ns.Account.prototype.handleInviteRemove = function( inviteId, roomId ) {
	const self = this;
	const remove = {
		type : 'invite',
		data : {
			type : 'remove',
			data : inviteId,
		},
	};
	self.conn.send( remove );
}

ns.Account.prototype.handleWorkgroupAssigned = function( addedWorg, roomId ) {
	const self = this;
	self.log( 'handleWorkgroupAssigned - noop', {
		added  : addedWorg,
		roomId : roomId,
	});
}

ns.Account.prototype.initializeClient = async function( event, clientId ) {
	const self = this
	const rooms = self.rooms.getRooms()
	const ids = {}
	const relations = await getRelations()
	const invites = await self.roomCtrl.getUserInvites( self.id )
	const worgs = getWorgs()
	const state = {
		identities : ids,
		rooms      : rooms,
		relations  : relations,
		contacts   : self.contactIds,
		invites    : invites,
		workgroups : worgs,
		account    : {
			host     : global.config.shared.wsHost,
			clientId : self.id,
			identity : self.identity,
		},
	}
	
	const init = {
		type : 'initialize',
		data : state,
	}
	self.conn.send( init, clientId );
	
	if ( !self.isLoaded )
		await self.loadTheThings();
	
	async function getIds() {
		const idList = Object.keys( self.IdsInUse );
		return await self.idCache.getMap( idList );
	}
	
	async function getRelations() {
		const contacts = {};
		const cList = await self.loadRelationState();
		cList.forEach( c => {
			const cId = c.clientId;
			contacts[ cId ] = c;
		});
		return contacts;
	}
	
	function getWorgs() {
		const ids = self.worgCtrl.getMemberOf( self.id )
		const worgs = {
			ids     : ids,
			members : {},
		}
		ids.forEach( wId => {
			const members = self.worgCtrl.getUserList( wId )
			worgs.members[ wId ] = members
		})
		
		return worgs
	}
}

ns.Account.prototype.loadRelationState = async function( contactId ) {
	const self = this;
	if ( self.closed ) {
		self.log( 'loadRelationState - closed???', self );
		return null;
	}
	
	const msgDb = new dFace.MessageDB( self.dbPool );
	if ( contactId )
		return await buildState( contactId );
	else
		return await Promise.all( self.relationIds.map( await buildState ));
	
	async function buildState( cId ) {
		let rId = self.relations[ cId ];
		const relation = await msgDb.getRelationState( rId, cId );
		
		let state = null;
		if ( relation )
			state = self.roomCtrl.readRoomState( rId );
		
		let contact = {
			clientId : cId,
			relation : relation,
			state    : state,
		};
		return contact;
	}
}

ns.Account.prototype.setIdentity = async function() {
	const self = this;
	self.identity = await self.idCache.get( self.id );
}

ns.Account.prototype.handleIdentity = function( event, cid ) {
	const self = this;
	self.idReq.handle( event );
	//self.setIdentity( id );
}

ns.Account.prototype.sendIdentity = function( event ) {
	const self = this;
	const wrap = {
		type : 'identity',
		data : event,
	};
	self.conn.send( wrap );
}

ns.Account.prototype.handleSettings = function( msg, cid ) {
	const self = this;
	self.log( 'handleSettings - noop', msg );
}

ns.Account.prototype.loadTheThings = async function() {
	const self = this;
	self.isLoaded = true;
	await self.loadRooms();
	await self.loadWorkRooms();
}

ns.Account.prototype.loadRooms = async function() {
	const self = this;
	if ( self.closed )
		return null;
	
	const roomDb = new dFace.RoomDB( self.dbPool );
	const memberWorgs = self.worgCtrl.getMemberOfAsFID( self.id );
	let list = null;
	try {
		list = await roomDb.getForAccount( self.id, memberWorgs );
	} catch( e ) {
		self.log( 'loadRooms - failed to load room list' );
		return false;
	}
	
	await Promise.all( list.map( await connect ));
	return true;
	
	async function connect( roomConf ) {
		let room = null;
		const roomId = roomConf.clientId;
		const canConnect = self.doPreConnect( roomId );
		if ( !canConnect )
			return false;
		
		if ( roomConf.wgs )
			room = await self.roomCtrl.connectWorkgroup( self.id, roomId );
		else
			room = await self.roomCtrl.connect( self.id, roomId );
		
		if ( !room ) {
			self.clearConnecting( roomId );
			return false;
		}
		
		await self.joinedARoomHooray( room );
		return true;
	}
}

ns.Account.prototype.loadRelations = async function() {
	const self = this;
	if ( self.closed )
		return null;
	
	const roomDb = new dFace.RoomDB( self.dbPool );
	let dbRelations = null;
	try {
		dbRelations = await roomDb.getRelationsFor( self.id );
	} catch( e ) {
		self.log( 'loadRelations - db err', e.stack || e );
		return;
	}
	
	if ( null == dbRelations )
		return;
	
	const reggings = dbRelations.map( rel => self.registerRelation( rel ));
	await Promise.all( reggings );
	return true;
	
	function addRelations( accIds ) {
		return Promise.all( accIds.map( addRel ));
		function addRel( accId ) {
			return self.registerRelation( accId );
		}
	}
	
	async function checkRoomAvailability( rel ) {
		const roomId = rel.roomId;
		const isActive = self.roomCtrl.checkActive( roomId );
		if ( !isActive )
			return;
		
		try {
			await self.openContactChat( null, rel.contactId );
		} catch ( ex ) {
			self.log( 'loadRelations - checkRoomAvailability ex', ex );
		}
	}
}

ns.Account.prototype.registerRelation = async function( relation ) {
	const self = this;
	let conId = relation.contactId;
	let rId = relation.relationId;
	self.relations[ conId ] = rId;
	self.relationIds.push( conId );
	self.rooms.listen( conId, e => self.handleContactListen( e, conId ));
	if ( !self.isLoaded )
		return conId;
	
	let contact = await self.loadRelationState( conId );
	if ( null == contact )
		contact = {
			clientId : conId,
		};
	
	
	const cAdd = {
		type : 'relation-add',
		data : contact,
	};
	self.conn.send( cAdd );
	
	return conId;
	
	/*
	function contactEvent( event, conId ) {
		self.handleContactListen( event, conId );
	}
	*/
}

ns.Account.prototype.loadContacts = async function() {
	const self = this;
	const onlyOnline = true;
	let contactIds = self.worgCtrl.getContactList( self.id, onlyOnline );
	await self.addContacts( contactIds );
	//self.contactIds = contactIds;
	return true;
}

ns.Account.prototype.loadWorkRooms = async function() {
	const self = this;
	const rooms = self.roomCtrl.getWorkRooms( self.id );
	const works = rooms.works;
	const views = rooms.views;
	await Promise.all( works.map( await connectWork ));
	await Promise.all( views.map( await connectWork ));
	
	async function connectWork( conf ) {
		const rId = conf.clientId;
		const wId = conf.worgId;
		const canConnect = self.doPreConnect( rId );
		if ( !canConnect )
			return;
		
		let room = await self.roomCtrl.connectWorkRoom( self.id, wId );
		if ( !room ) {
			self.clearConnecting( rId );
			//self.log( 'loadWorkRooms - could not connect to room', wId );
			return;
		}
		
		await self.joinedARoomHooray( room );
	}
	
}

ns.Account.prototype.getRoom = function( roomId, cId ) {
	const self = this;
	const room = self.rooms.get( roomId );
	if ( !room )
		return;
	
	const conf = room.getConf();
	self.sendJoined( conf, null, cId );
}

ns.Account.prototype.joinRoom = async function( conf, cid ) {
	const self = this;
	const room = await self.roomCtrl.joinRoom( self.id, conf.invite );
	if ( !room ) {
		self.log( 'failed to join a room', {
			err  : err.stack || err,
			room : room,
			conf : conf, }, 4 );
		return null;
	}
	
	await self.joinedARoomHooray( room, conf.req );
	return true;
}

ns.Account.prototype.handleRoomCreate = async function( conf ) {
	const self = this;
	conf = conf || {};
	const room = await self.roomCtrl.createRoom( self.id, conf );
	if ( !room ) {
		self.log( 'failed to set up a room', {
			err  : err.stack || err,
			room : room,
			conf : conf,
		}, 4 );
		throw 'ERR_CREATE_ROOM_COULD_NOT';
	}
	
	await self.joinedARoomHooray( room );
	const roomConf = room.getConf();
	return roomConf;
}

ns.Account.prototype.connectedRoom = async function( room ) {
	const self = this;
	const connected = {
		type : 'connect',
		data : {
			clientId   : room.roomId,
			persistent : room.persistent,
			name       : room.roomName,
		},
	};
	let sendRes = await self.conn.send( connected );
	self.rooms.add( room );
	//room.setIdentity( self.identity );
}

ns.Account.prototype.doPreConnect = function( roomId ) {
	const self = this;
	if ( !roomId || !( 'string' === typeof( roomId )))
		throw new Error( 'no room id' );
	
	if ( self.rooms.isParticipant( roomId ))
		return false;
	
	if ( self.connecting[ roomId ])
		return false;
	
	self.connecting[ roomId ] = true;
	return true;
}

ns.Account.prototype.clearConnecting = function( roomId ) {
	const self = this;
	delete self.connecting[ roomId ];
}

ns.Account.prototype.joinedARoomHooray = async function( room, reqId  ) {
	const self = this;
	if ( !room || !room.roomId || !room.roomName ) {
		self.log( 'joinedARoom - didnt join a room', room );
		return null;
	}
	
	const conf = room.getConf();
	const rId = conf.clientId;
	self.clearConnecting( rId );
	conf.req = reqId;
	const currentRooms = self.rooms.add( room );
	
	self.sendJoined( conf, currentRooms );
	
	return null;
	
}

ns.Account.prototype.sendJoined = async function( roomConf, currentRooms, clientId ) {
	const self = this;
	const joined = {
		type : 'join',
		data : {
			joined  : roomConf,
			current : currentRooms,
		},
	};
	
	await self.conn.send( joined, clientId );
}

ns.Account.prototype.handleRoomClosed = function( roomId ) {
	const self = this;
	if ( self.contacts[ roomId ])
		return;
	
	const close = {
		type : 'close',
		data : roomId,
	};
	self.conn.send( close );
}

ns.Account.prototype.handleContactListen = async function( event, contactId ) {
	const self = this;
	let room = await self.handleContactActive( null, contactId );
	if ( !room ) {
		self.log( 'handleContactListen - could not room', contactId );
		return null;
	}
	
	room.toRoom( event );
}

ns.Account.prototype.handleContactEvent = function( event, clientId ) {
	const self = this;
	let handler = self.clientContactEvents[ event.type ];
	if ( !handler )
		return;
	
	return handler( event.data, clientId );
}

ns.Account.prototype.handleContactList = async function( event, connId ) {
	const self = this;
	if ( self.contactsAllSorted ) {
		timeoutCache();
		return self.contactsAllSorted;
	}
	
	const list = await self.worgCtrl.getContactListSorted( self.id );
	const uIdx = list.indexOf( self.id );
	if ( -1 != uIdx )
		list.splice( uIdx, 1 );
	
	self.contactsAllSorted = list;
	timeoutCache();
	return self.contactsAllSorted;
	
	function timeoutCache() {
		if ( null != self.contactsAllSortedTimeout )
			clearTimeout( self.contactsAllSortedTimeout );
		
		self.contactsAllSortedTimeout = setTimeout( clear, 1000 * 600 );
	}
	
	function clear() {
		self.clearAllSorted();
	}
}

ns.Account.prototype.clearAllSorted = function() {
	const self = this;
	delete self.contactsAllSorted;
	if ( null == self.contactsAllSortedTimeout )
		return;
	
	clearTimeout( self.contactsAllSortedTimeout );
	delete self.contactsAllSortedTimeout;
}

ns.Account.prototype.handleAvatarEvent = function( event, clientId ) {
	const self = this;
	self.idCache.updateAvatar( self.id, event.avatar );
}

ns.Account.prototype.handleInviteResponse = async function( res, clientId ) {
	const self = this;
	let room = null;
	if ( res.accepted ) {
		room = await self.roomCtrl.acceptInvite( self.id, res );
		if ( !room )
			return 'ERR_COULD_NOT_JOIN';
	}
	else {
		self.roomCtrl.rejectInvite( self.id, res );
		return true;
	}
	
	self.joinedARoomHooray( room );
	return null;
}

ns.Account.prototype.handleHiddenList = async function( req, clientId ) {
	const self = this;
	if ( self.closed )
		return;
	
	const roomDb = new dFace.RoomDB( self.dbPool );
	const rels = await roomDb.getRelationsFor( self.id, true );
	const disabled = rels.filter( rel => !!rel.fIsDisabled )
		.map( rel => rel.contactId );
		
	const hiddenIds = await Promise.all( disabled.map( getId ));
	const hidden = hiddenIds.map( id => {
		return {
			clientId    : id.clientId,
			name        : id.name,
			fIsDisabled : id.fIsDisabled,
		};
	});
	
	return hidden;
	
	function getId( cId ) {
		return self.idCache.get( cId );
	}
}

ns.Account.prototype.handleHiddenOpen = async function( contactId ) {
	const self = this;
	if ( self.contacts[ contactId ]) {
		return;
	}
	
	if ( true === self.hidden[ contactId ])
		return null;
	
	if ( self.hidden[ contactId ]) {
		const conf = await hasRoom( contactId );
		if ( conf )
			return conf;
	}
	
	self.hidden[ contactId ] = true;
	const roomDb = new dFace.RoomDB( self.dbPool );
	const rel = await roomDb.getRelationFor( self.id, contactId );
	if ( null == rel ) {
		return null;
	}
	
	const room = await self.roomCtrl.connectContact( self.id, contactId );
	if ( !room ) {
		self.log( 'openHiddenChat - failed to connect room', contactId );
		return null;
	}
	
	self.hidden[ contactId ] = rel.clientId;
	self.rooms.add( room );
	return await hasRoom( contactId );
	
	async function hasRoom( cId ) {
		const room = self.rooms.get( cId );
		if ( !room )
			return null;
		
		const identity = await self.idCache.get( cId );
		const conf = room.getConf();
		conf.identity = identity;
		
		return conf;
	}
}

ns.Account.prototype.handleHiddenClose = async function( contactId ) {
	const self = this;
	delete self.hidden[ contactId ];
	self.rooms.remove( contactId );
}

ns.Account.prototype.handleDisableChange = function( update ) {
	const self = this;
	const cId = update.clientId;
	const isDisabled = !!update.value;
	if ( isDisabled )
		remove( cId );
	else
		add( cId );
	
	function remove( cId ) {
		const relation = self.relations[ cId ];
		if ( !relation )
			return;
		
		//delete self.relations[ cId ];
		self.removeRelation( cId );
	}
	
	async function add( cId ) {
		if ( self.relations[ cId ])
			return;
		
		const roomDb = new dFace.RoomDB( self.dbPool );
		const relation = await roomDb.getRelationFor( self.id, cId );
		if ( null == relation )
			return;
		
		self.registerRelation( relation );
		/*
		self.relations[ cId ] = relation.clientId;
		self.addRelation( cId );
		*/
	}
}

ns.Account.prototype.sendContactEvent = function( type, event ) {
	const self = this;
	const wrap = {
		type : 'contact-event',
		data : {
			type : type,
			data : event,
		},
	};
	self.conn.send( wrap );
}

ns.Account.prototype.handleOpenContactChat = async function( contactId, clientId ) {
	const self = this;
	if ( self.relations[ contactId ]) {
		self.connectToContact( contactId );
		return;
	}
	
	await self.addRelation( contactId );
	await self.connectToContact( contactId );
}

ns.Account.prototype.handleFriendGet = async function( event ) {
	const self = this;
	let id = await self.idCache.getByFUserId( event.friendId );
	return id || null;
}

ns.Account.prototype.handleSearchUser = async function( req ) {
	const self = this;
	let cIds = await self.idCache.search( req.needle );
	
	let flatContacts = null;
	const waiters = cIds.map( allowInSearch );
	cIds = await Promise.all( waiters );
	cIds = cIds.filter( cId => !!cId );
	
	const waits = cIds.map( cId => self.idCache.get( cId ));
	const items = await Promise.all( waits );
	
	return items;
	
	async function allowInSearch( cId ) {
		const settings = await self.idCache.getSettingsFor( cId );
		if ( null == settings.hideInSearch )
			return cId;
		
		if ( false == settings.hideInSearch )
			return cId;
		
		if ( null == flatContacts ) {
			flatContacts = self.worgCtrl.getFlatContacts( self.id );
		}
		
		if ( flatContacts[ cId ])
			return cId;
		
		return null;
	}
}

ns.Account.prototype.handleAccSettingSet = async function( e ) {
	const self = this;
	const res = self.idCache.setSetting( self.id, e.key, e.value );
	return res;
}

ns.Account.prototype.handleAddRelation = async function( event ) {
	const self = this;
	console.log( 'handleAddRelation', event );
	const cId = event.clientId;
	if ( !cId )
		throw new Error( 'ERR_INVALID_ID' );
	
	const id = await self.idCache.get( cId );
	if ( !id )
		throw new Error( 'ERR_NOT_A_USER' );
	
	return await self.addRelation( cId );
}

ns.Account.prototype.logout = function( callback ) {
	const self = this;
	if ( self.roomCtrl )
		self.roomCtrl.release( self.id );
	
	if ( self.rooms )
		self.rooms.close();
	
	if ( self.conn )
		self.conn.close();
	
	if ( self.session )
		self.session.close();
	
	if ( self.idReq )
		self.idReq.close();
	
	delete self.roomCtrl;
	delete self.rooms;
	delete self.conn;
	delete self.session;
	delete self.idReq;
	delete self.idNode;
	
	if ( callback )
		callback();
}

// ROOMS

const rLog = require( './Log' )( 'account > rooms' );

ns.Rooms = function( conn ) {
	const self = this;
	events.Emitter.call( self );
	self.conn = conn;
	
	self.rooms = {};
	self.list = [];
	
	self.init();
}

util.inherits( ns.Rooms, events.Emitter );

// Public

ns.Rooms.prototype.send = function( event, roomId ) {
	const self = this;
	var room = self.rooms[ roomId ];
	if ( !room )
		return;
	
	room.toRoom( event );
}

ns.Rooms.prototype.isParticipant = function( roomId ) {
	const self = this;
	return !!self.rooms[ roomId ];
}

ns.Rooms.prototype.listen = function( roomId, callback ) {
	const self = this;
	self.conn.once( roomId, callback );
}

ns.Rooms.prototype.add = function( room ) {
	const self = this;
	const rid = room.roomId;
	if ( self.rooms[ rid ]) {
		rLog( 'add - already added', self.rooms );
		return;
	}
	
	self.rooms[ rid ] = room;
	self.list.push( rid );
	self.conn.on( rid, fromClient );
	room.setToAccount( fromRoom );
	room.setOnclose( onClose );
	
	return self.list;
	
	function fromRoom( e ) { self.handleRoomEvent( e, rid ); }
	function fromClient( e ) { self.handleClientEvent( e, rid ); }
	function onClose( e ) { self.handleRoomClosed( rid ); }
}

ns.Rooms.prototype.get = function( roomId ) {
	const self = this;
	return self.rooms[ roomId ] || null;
}

ns.Rooms.prototype.remove = function( roomId ) {
	const self = this;
	const rid = roomId;
	if ( !self.conn )
		return;
	
	self.conn.release( rid );
	const room = self.rooms[ rid ];
	if ( !room )
		return null;
	
	delete self.rooms[ rid ];
	self.list = Object.keys( self.rooms );
	room.disconnect();
}

ns.Rooms.prototype.getRooms = function() {
	const self = this;
	const rooms = self.list
		.map( roomConf )
		.filter( conf => !!conf );
		
	return rooms;
	
	function roomConf( rid ) {
		const room = self.rooms[ rid ];
		if ( room.isPrivate )
			return null;
		
		return room.getConf();
	}
}

ns.Rooms.prototype.close = function() {
	const self = this;
	self.release();
	releaseClients();
	leaveRooms();
	
	delete self.conn;
	self.rooms = {};
	
	function releaseClients() {
		for( const rid in self.rooms )
			self.conn.release( rid );
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
	if ( !self.conn )
		return;
	
	const eventWrap = {
		type : roomId,
		data : event,
	};
	self.conn.send( eventWrap );
}

ns.Rooms.prototype.handleClientEvent = function( event, roomId ) {
	const self = this;
	const room = self.rooms[ roomId ];
	if ( !room ) {
		rLog( 'no room for event', {
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
