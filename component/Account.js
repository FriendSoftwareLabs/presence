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
	self.ids = {};
	self.contacts = {};
	self.contactIds = [];
	self.relations = {};
	
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
	
	self.rooms.listen( accId, contactEvent );
	self.contacts[ accId ] = accId;
	self.contactIds.push( accId );
	await self.addIdentity( accId );
	const rel = await self.getContactRelation( accId );
	
	const contact = {
		clientId : accId,
		relation : rel.relation,
	};
	const cAdd = {
		type : 'contact-add',
		data : contact,
	};
	self.conn.send( cAdd );
	
	const isOnline = self.idCache.checkOnline( accId );
	self.updateContactStatus( 'online', accId, isOnline );
	
	return accId;
	
	function contactEvent( event ) {
		let contactId = accId;
		self.handleContactListen( event, contactId );
	}
}

ns.Account.prototype.updateContacts = function() {
	const self = this;
	const cList = self.worgCtrl.getContactList( self.id );
	const cMap = {};
	cList.forEach( accId => {
		cMap[ accId ] = true;
		self.addContact( accId );
	});
	const removed = self.contactIds.filter( notInList );
	removed.forEach( accId => self.removeContact( accId ));
	
	function notInList( currId ) {
		return !cMap[ currId ];
	}
}

ns.Account.prototype.removeContact = function( contactId ) {
	const self = this;
	if ( self.relations[ contactId ])
		return;
	
	if ( !self.contacts[ contactId ])
		return;
	
	const contacts = self.worgCtrl.getContactList( self.id );
	const cIndex = contacts.indexOf( contactId );
	if ( -1 != cIndex )
		return;
	
	self.rooms.remove( contactId );
	delete self.contacts[ contactId ];
	self.contactIds = Object.keys( self.contacts );
	const cRemove = {
		type : 'contact-remove',
		data : contactId,
	};
	self.conn.send( cRemove );
}

ns.Account.prototype.updateContactStatus = function( type, contactId, data ) {
	const self = this;
	if ( !self.ids[ contactId ])
		return;
	
	const event = {
		contactId : contactId,
		data      : data,
	};
	
	self.sendContactEvent( type, event );
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
		'workroom-join'  : workRoomJoin,
		'workroom-view'  : workRoomView,
		'workgroup-join' : workgroupJoin,
		'contact-join'   : contactJoin,
		'contact-event'  : contactRoomEvent,
	};
	
	function roomCtrlEvent( e, rid ) { self.handleRoomCtrlEvent( e, rid ); }
	function workRoomJoin( e, rid ) { self.handleWorkRoomJoin( e, rid ); }
	function workRoomView( e, rid ) { self.handleWorkRoomView( e, rid ); }
	function workgroupJoin( e, rid ) { self.handleWorkgroupJoin( e, rid ); }
	function contactJoin( e, rid ) { self.openContactChat( e, rid ); }
	function contactRoomEvent( e, rid ) { self.handleContactRoomEvent( e, rid ); }
}

ns.Account.prototype.bindContactEvents = function() {
	const self = this;
	self.clientContactEvents = {
		'start' : startContactChat,
	};
	
	function startContactChat( e, cId ) { self.handleStartContactChat( e, cId ); }
}

ns.Account.prototype.bindConn = function() {
	const self = this;
	self.conn = new events.EventNode( self.id, self.session, accEventSink );
	self.conn.on( 'initialize', init );
	self.conn.on( 'settings', handleSettings );
	self.conn.on( 'room', handleRoomMsg );
	self.conn.on( 'join', joinRoom );
	self.conn.on( 'create', createRoom );
	self.conn.on( 'contact', handleContact );
	
	function accEventSink() {} //self.log( 'accEventSink', arguments, 3 ); }
	function init( e, cid ) { self.initializeClient( e, cid ); }
	function handleSettings( e, cid ) { self.handleSettings( e, cid ); }
	function handleRoomMsg( e, cid ) { self.log( 'roomMsg', msg ); }
	function joinRoom( e, cid ) { self.joinRoom( e, cid ); }
	function createRoom( e, cid ) { self.createRoom( e, cid ); }
	function handleContact( e, cid ) { self.handleContactEvent( e, cid ); }
	
	self.req = new events.RequestNode( self.conn, reqEventSink );
	self.req.on( 'friend-get', fGet );
	self.req.on( 'contact-add', addContact );
	
	function reqEventSink( ...args ) { self.log( 'req event sink', args, 3 ); }
	function fGet( e ) { return self.handleFriendGet( e ); }
	function addContact( e ) { return self.handleAddContact( e ); }
	
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
	self.idNode = new events.EventNode( 'identity', self.conn );
	self.idReq = new events.RequestNode( self.idNode );
	self.idReq.on( 'get', e => { return self.handleIdGet( e ); });
	self.idReq.on( 'get-list', e => { return self.handleIdList( e ); })
}

ns.Account.prototype.handleIdGet = async function( clientId ) {
	const self = this;
	let id = self.ids[ clientId ];
	if ( id )
		return id;
	
	id = await self.idCache.get( clientId );
	self.ids[ clientId ] = id;
	return id;
}

ns.Account.prototype.handleIdList = async function( list ) {
	const self = this;
	const local = [];
	const unknown = list.filter( cId => {
		const id = self.ids[ cId ];
		if ( !id )
			return true;
		
		local.push( id );
		return false;
	});
	
	const fetched = await self.idCache.getList( unknown );
	fetched.forEach( user => {
		let cId = user.clientId;
		self.ids[ cId ] = user;
	});
	
	return [ ...local, ...fetched ];
}

ns.Account.prototype.handleRoomCtrlEvent = function( event, roomId ) {
	const self = this;
	const handler = self.roomCtrlEvents[ event.type ];
	if ( !handler ) {
		self.log( 'handleRoomCtrlEvent - no handler for', event );
		return;
	}
	
	handler( event.data, roomId );
}

ns.Account.prototype.handleWorkRoomJoin = async function( worgId, roomId ) {
	const self = this;
	const canConnect = self.doPreConnect( roomId );
	if ( !canConnect )
		return;
	
	let room = await self.roomCtrl.connectWorkRoom( self.id, worgId );
	if ( !room ) {
		self.log( 'loadWorkRoom - could not connect to room', worgId );
		self.clearConnecting( roomId );
		return;
	}
	
	await self.joinedARoomHooray( room );
}

ns.Account.prototype.handleWorkRoomView = async function( worgId, roomId ) {
	const self = this;
	const canConnect = self.doPreConnect( roomId );
	if ( !canConnect )
		return;
	
	let room = await self.roomCtrl.connectWorkView( self.id , worgId );
	if ( !room ) {
		self.log( 'handleWorkRoomView - could not connect to room', worgId );
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

ns.Account.prototype.openContactChat = async function( event, contactId ) {
	const self = this;
	if ( !contactId )
		return;
	
	if ( !self.contacts[ contactId ])
		await self.addContact( contactId );
	
	let room = self.rooms.get( contactId );
	if ( room ) {
		sendOpen();
		return room;
	}
	
	room = await self.roomCtrl.connectContact( self.id, contactId );
	if ( !room ) {
		self.log( 'openContactChat - failed to connect to room', contactId );
		return null;
	}
	
	const roomDb = new dFace.RoomDB( self.dbPool );
	let relation = await roomDb.getRelation( self.id, contactId );
	self.relations[ contactId ] = relation.clientId;
	await self.joinedARoomHooray( room );
	sendOpen();
	return room;
	
	function sendOpen() {
		return;
		const open = {
			type : 'open',
			data : true,
		};
		room.send( open );
	}
}

ns.Account.prototype.handleContactRoomEvent = function( event, contactId ) {
	const self = this;
	self.log( 'handleContactRoomEvent - NYI', {
		e : event,
		r : contactId,
	});
	
}

ns.Account.prototype.handleWorkgroupAssigned = function( addedWorg, roomId ) {
	const self = this;
	self.log( 'handleWorkgroupAssigned - NYI', {
		added  : addedWorg,
		roomId : roomId,
	});
}

ns.Account.prototype.initializeClient = async function( event, clientId ) {
	const self = this;
	const rooms = self.rooms.getRooms();
	const state = {
		type : 'initialize',
		data : {
			account    : {
				host     : global.config.shared.wsHost,
				clientId : self.id,
				identity : self.identity,
			},
			identities : await getIds(),
			rooms      : rooms,
			contacts   : await getContactRelations(),
		},
	};
	self.conn.send( state, clientId );
	
	if ( !self.isLoaded )
		await self.loadTheThings();
	
	async function getIds() {
		const idList = Object.keys( self.ids );
		return await self.idCache.getMap( idList );
	}
	
	async function getContactRelations() {
		const contacts = {};
		const cList = await self.getContactRelation();
		cList.forEach( c => {
			const cId = c.clientId;
			contacts[ cId ] = c;
		});
		return contacts;
	}
}

ns.Account.prototype.getContactRelation = async function( contactId ) {
	const self = this;
	const msgDb = new dFace.MessageDB( self.dbPool );
	if ( contactId )
		return await getState( contactId );
	else
		return await Promise.all( self.contactIds.map( await getState ));
	
	async function getState( cId ) {
		let rId = self.relations[ cId ];
		let state = null;
		if ( rId )
			state = await msgDb.getRelationState( rId, cId );
		
		let contact = {
			clientId : cId,
			relation : state,
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

ns.Account.prototype.addIdentity = async function( clientId ) {
	const self = this;
	if ( self.ids[ clientId ])
		return;
	
	const identity = await self.idCache.get( clientId );
	if ( !identity )
		return false;
	
	self.ids[ clientId ] = clientId;
	const idAdd = {
		type : 'add',
		data : identity,
	};
	self.sendIdentity( idAdd );
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
	self.log( 'handleSettings - NYI', msg );
}

ns.Account.prototype.loadTheThings = async function() {
	const self = this;
	self.isLoaded = true;
	await self.loadRooms();
	await self.loadWorkRooms();
}

ns.Account.prototype.loadRooms = async function() {
	const self = this;
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
	const roomDb = new dFace.RoomDB( self.dbPool );
	let dbRelations = null;
	try {
		dbRelations = await roomDb.getRelationsFor( self.id );
	} catch( e ) {
		self.log( 'loadRelations - db err', e.stack || e );
		return;
	}
	
	dbRelations.forEach( rel => {
		let cId = rel.contactId;
		let rId = rel.relationId;
		self.relations[ cId ] = rId;
	});
	const contactIdList = dbRelations.map( rel => rel.contactId );
	await self.addContacts( contactIdList );
	try {
		Promise.all( dbRelations.map( await checkRoomAvailability ));
	} catch ( err ) {
		self.log( 'loadRelations - checkRoomAvailability', err );
	}
	
	return true;
	
	async function checkRoomAvailability( rel ) {
		const roomId = rel.roomId;
		const isActive = self.roomCtrl.checkActive( roomId );
		if ( !isActive )
			return;
		
		await self.openContactChat( null, rel.contactId );
	}
	
}

ns.Account.prototype.loadContacts = async function() {
	const self = this;
	let contactIds = self.worgCtrl.getContactList( self.id );
	await self.addContacts( contactIds );
	return true;
}

ns.Account.prototype.loadWorkRooms = async function() {
	const self = this;
	const rooms = self.roomCtrl.getWorkRooms( self.id );
	const works = rooms.works;
	const views = rooms.views;
	await Promise.all( works.map( await connectWork ));
	await Promise.all( views.map( await connectView ));
	
	async function connectWork( conf ) {
		const rId = conf.clientId;
		const wId = conf.worgId;
		const canConnect = self.doPreConnect( rId );
		if ( !canConnect )
			return;
		
		let room = await self.roomCtrl.connectWorkRoom( self.id, wId );
		if ( !room ) {
			self.log( 'loadWorkRoom - could not connect to room', wId );
			return;
		}
		
		await self.joinedARoomHooray( room );
	}
	
	async function connectView( conf ) {
		const rId = conf.clientId;
		const wId = conf.worgId;
		const canConnect = self.doPreConnect( rId );
		if ( !canConnect )
			return;
		
		const room = await self.roomCtrl.connectWorkView( self.id, wId );
		if ( !room ) {
			self.log( 'loadWorkRooms - could not conenct to view', wId );
			return;
		}
		
		await self.joinedARoomHooray( room );
	}
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

ns.Account.prototype.createRoom = async function( conf, cid ) {
	const self = this;
	conf = conf || {};
	const room = await self.roomCtrl.createRoom( self.id, conf );
	if ( !room ) {
		self.log( 'failed to set up a room', {
			err  : err.stack || err,
			room : room,
			conf : conf,
		}, 4 );
		return;
	}
	
	await self.joinedARoomHooray( room, conf.req );
	return true;
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
	if ( !roomId || !( 'string' === typeof( roomId ))) {
		throw new Error( 'no room id' );
		return;
	}
	
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
		return;
	}
	
	const conf = room.getConf();
	const rId = conf.clientId;
	self.clearConnecting( rId );
	conf.req = reqId;
	const joined = {
		type : 'join',
		data : conf,
	};
	
	await self.conn.send( joined );
	self.rooms.add( room );
	//room.setIdentity( self.identity );
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
	let room = await self.openContactChat( null, contactId );
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
	
	handler( event.data, clientId );
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

ns.Account.prototype.handleStartContactChat = async function( contactId, clientId ) {
	const self = this;
	if ( self.contacts[ contactId ])
		return;
	
	self.addContact( contactId );
}

ns.Account.prototype.someContactFnNotInUse = async function( event, clientId ) {
	const self = this;
	const contactId = event.clientId;
	const room = self.rooms.get( contactId );
	if ( room )
		return room;
	
	const contact = await self.roomCtrl.connectContact( self.id, contactId );
	if ( !contact )
		return;
	
	await self.joinedARoomHooray( contact );
	return contact;
}

ns.Account.prototype.handleFriendGet = async function( event ) {
	const self = this;
	let id = await self.idCache.getByFUserId( event.friendId );
	return id || null;
}

ns.Account.prototype.handleAddContact = async function( event ) {
	const self = this;
	const cId = event.clientId;
	if ( !cId )
		throw new Error( 'ERR_INVALID_ID' );
	
	return await self.addContact( event.clientId );
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
	
	if ( self.idNode )
		self.idNode.close();
	
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
