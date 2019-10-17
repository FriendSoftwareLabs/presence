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

const FService = require( '../api/FService' );
const log = require( './Log' )( 'ContactRoom' );
const components = require( './RoomComponents' );
const Signal = require( './Signal' );
const dFace = require( './DFace' );
const Janus = require( './Janus' );
const Room = require( './Room' );
const util = require( 'util' );

var ns = {};

ns.ContactRoom = function( conf, db, idCache ) {
	const self = this;
	self.relationId = conf.ownerId;
	Room.call( self, conf, db, idCache );
}

util.inherits( ns.ContactRoom, Room );

ns.ContactRoom.prototype.setRelation = async function( relation ) {
	const self = this;
	const auth = [
		relation.relations[ 0 ].userId,
		relation.relations[ 1 ].userId,
	];
	
	const roomDb = new dFace.RoomDB( self.dbPool, self.id );
	await roomDb.authorize(
		self.id,
		auth,
	);
	await self.loadUsers();
}

ns.ContactRoom.prototype.connect = async function( userId ) {
	const self = this;
	const authed = self.checkIsAuthed( userId );
	if ( !authed )
		return false;
	
	if ( !self.users.exists( userId ))
		await self.addUser( userId );
	
	const signal = self.bindUser( userId );
	if ( self.emptyTimer ) {
		clearTimeout( self.emptyTimer );
		self.emptyTimer = null;
	}
	
	return signal;
}

ns.ContactRoom.prototype.disconnect = function( accountId ) {
	const self = this;
	self.releaseUser( accountId );
}

ns.ContactRoom.prototype.authorizeUser = async function( userId ) {
	const self = this;
	return false;
}

ns.ContactRoom.prototype.authenticateInvite = async function( token ) {
	const self = this;
	return false;
}

ns.ContactRoom.prototype.init = async function() {
	const self = this;
	self.service = new FService();
	self.roomDb = new dFace.RoomDB( self.dbPool, self.id );
	self.users = new ns.ContactUsers(
		self.dbPool,
		self.id,
	);
	await self.users.initialize();
	
	self.settings = new ns.ContactSettings(
		self.dbPool,
		self.id,
		self.users,
	);
	await self.settings.initialize();
	
	self.log = new ns.ContactLog(
		self.dbPool,
		self.id,
		self.users,
		self.idCache,
		self.ownerId
	);
	await self.log.initialize();
	
	self.chat = new ns.ContactChat(
		self.id,
		self.users,
		self.log,
		self.service
	);
	
	self.live = new components.Live(
		self.users,
		self.log,
		null,
		self.settings
	);
	
	try {
		await self.loadUsers();
	} catch( e ) {
		log( 'load fail', e );
	}
	
	self.setOpen();
}

ns.ContactRoom.prototype.loadUsers = async function() {
	const self = this;
	let auths = null;
	try {
		auths = await self.roomDb.loadAuthorizations( self.id );
	} catch ( e ) {
		log( 'loading auths failed', e.stack || e );
		return false;
	}
	
	if ( !auths || 2 !== auths.length )
		return false;
	
	try {
		await Promise.all( auths.map( add ));
	} catch ( e ) {
		log( 'opps', e.stack || e );
	}
	
	return true;
	
	async function add( dbUser ) {
		const cId = dbUser.clientId;
		self.users.addAuthorized( cId );
		await self.addUser( cId );
	}
}

ns.ContactRoom.prototype.bindUser = function( userId ) {
	const self = this;
	const id = self.users.get( userId );
	if ( id.close ) {
		log( 'bindUser - user already bound' );
		return;
	}
	
	if ( !id ) {
		log( 'bindUSer - no user for id', {
			roomId : self.id,
			userId : userId,
			users  : self.users.getList(),
		}, 4 );
		try {
			throw new Error( 'blah' );
		} catch( e ) {
			log( 'trace', e.stack || e );
		}
		return null;
	}
	
	// removing basic user obj
	const otherAcc = self.users.getOther( userId );
	const otherId = otherAcc.clientId;
	const otherName = otherAcc.name;
	// add signal user obj
	const sigConf = {
		roomId     : otherId,
		roomName   : otherName,
		//roomAvatar : self.avatar,
		isPrivate  : true,
		persistent : true,
		clientId   : id.clientId,
		name       : id.name,
		fUsername  : id.fUsername,
		avatar     : id.avatar,
		isOwner    : false,
		isAuthed   : true,
	};
	const user = new Signal( sigConf );
	self.users.set( user );
	
	// bind room events
	user.on( 'initialize', init );
	user.on( 'persist', persist );
	user.on( 'disconnect', goOffline );
	user.on( 'leave', leaveRoom );
	user.on( 'live-join', joinLive );
	user.on( 'live-restore', restoreLive );
	user.on( 'live-leave', leaveLive );
	user.on( 'active', active );
	user.on( 'open', open );
	
	let uid = userId;
	function init( e ) { self.initialize( e, uid ); }
	function persist( e ) { self.handlePersist( e, uid ); }
	function goOffline( e ) { self.disconnect( uid ); }
	function leaveRoom( e ) { self.handleLeave( uid ); }
	function joinLive( e ) { self.handleJoinLive( e, uid ); }
	function restoreLive( e ) { self.handleRestoreLive( e, uid ); }
	function leaveLive( e ) { self.handleLeaveLive( e, uid ); }
	function active( e ) { self.handleActive( e, uid ); }
	function open( e ) { self.handleOpen( uid ); }
	
	// add to components
	self.chat.bind( userId );
	self.settings.bind( userId );
	
	// show online
	self.users.setOnline( userId );
	return user;
}

ns.ContactRoom.prototype.handleOpen = function( userId ) {
	const self = this;
	const open = {
		type : 'open',
		data : true,
	};
	self.send( open, userId );
}

ns.ContactRoom.prototype.getRoomRelation = async function( userId ) {
	const self = this;
	const other = self.users.getOther( userId );
	const msgDb = new dFace.MessageDB( self.dbPool );
	const rel = await msgDb.getRelationState( self.relationId, other.clientId );
	const lastMessages = self.log.getLast( 1 );
	const relation = {
		unreadMessages : rel ? rel.unreadMessages : 0,
		lastMessage    : rel ? rel.lastMessage : null,
	};
	
	msgDb.close();
	return relation;
}

ns.ContactRoom.prototype.initialize = async function( requestId, userId ) {
	const self = this;
	const otherAcc = self.users.getOther( userId );
	const relation = await self.getRoomRelation( userId );
	const state = {
		id          : otherAcc.clientId,
		name        : otherAcc.name,
		ownerId     : self.ownerId,
		persistent  : self.persistent,
		isPrivate   : true,
		settings    : self.settings.get(),
		guestAvatar : self.guestAvatar,
		users       : buildBaseUsers(),
		online      : self.users.getOnline(),
		peers       : self.live.peerIds,
		workgroups  : null,
		relation    : relation,
	};
	
	const init = {
		type : 'initialize',
		data : state,
	};
	self.send( init, userId );
	
	function buildBaseUsers() {
		const users = {};
		const uIds = self.users.getList();
		uIds.forEach( build );
		return users;
		
		function build( uId ) {
			let user = self.users.get( uId );
			users[ uId ] = {
				clientId   : uId,
				isAuthed   : true,
				workgroups : [],
			};
		}
	}
}

ns.ContactRoom.prototype.addUser = async function( userId ) {
	const self = this;
	// add to users
	if ( self.users.exists( userId )) {
		return userId;
	}
	
	const user = await self.idCache.get( userId );
	await self.users.set( user );
	return true;
}

/*
	ContactUsers
*/

const uLog = require( './Log' )( 'ContactRoom > Chat' );
ns.ContactUsers = function(
	dbPool,
	roomId
) {
	const self = this;
	components.Users.call( self,
		dbPool,
		roomId,
		true,
		null
	);
}

util.inherits( ns.ContactUsers, components.Users );

ns.ContactUsers.prototype.getOther = function( clientId ) {
	const self = this;
	const list = self.getList();
	const otherId = list[ 0 ] === clientId ? list[ 1 ] : list[ 0 ];
	const other = self.everyone[ otherId ];
	return other;
}

/*
	ContactChat
*/

const cLog = require( './Log')( 'ContactRoom > Chat' );
ns.ContactChat = function(
	roomId,
	users,
	log,
	service
) {
	const self = this;
	components.Chat.call( self,
		roomId,
		null,
		users,
		log,
		service
	);
}

util.inherits( ns.ContactChat, components.Chat );

ns.ContactChat.prototype.handleConfirm = function( event, userId ) {
	const self = this;
	if ( 'message' === event.type ) {
		confirmMessage( event.eventId, userId );
		return;
	}
	
	async function confirmMessage( msgId, userId ) {
		const res = await self.log.confirm( msgId, userId );
		if ( !res )
			return;
		
		const notie = {
			type : 'message',
			data : res,
		};
		
		sendConfirm( notie, userId );
	}
	
	function sendConfirm( event, userId ) {
		const confirm = {
			type : 'confirm',
			data : event,
		};
		const other = self.users.getOther( userId );
		const contactId = other.clientId;
		self.send( confirm, contactId );
	}
}

ns.ContactChat.prototype.sendMsgNotification = async function( msg, fromId ) {
	const self = this;
	const mId = msg.msgId;
	const time = msg.time;
	const message = msg.message;
	const from = self.users.get( fromId );
	const roomName = from.name;
	const notie = message;
	const uIds = self.users.getList();
	const extra = {
		isPrivate : true,
		roomId    : fromId,
		msgId     : mId,
	};
	
	const userList = [];
	uIds.forEach( uId => {
		if ( fromId === uId )
			return;
		
		const user = self.users.get( uId );
		if ( !user || !user.fUsername )
			return;
		
		userList.push( user.fUsername );
	});
	
	try {
		await self.service.sendNotification(
			userList,
			roomName,
			notie,
			self.roomId,
			time,
			extra
		);
	} catch( e ) {
		cLog( 'sendMsgNotification - err', e );
	}
}

/*
	ContactSettings
*/

const sLog = require( './Log' )( 'ContactRoom > Settings' );
ns.ContactSettings = function(
	dbPool,
	roomId,
	users,
) {
	const self = this;
	components.Settings.call( self,
		dbPool,
		null,
		roomId,
		users,
		true,
		null,
	);
}

util.inherits( ns.ContactSettings, components.Settings );

ns.ContactSettings.prototype.init = async function( dbPool, ignore ) {
	const self = this;
	self.handlerMap = {
	};
	
	self.list = Object.keys( self.handlerMap );
	self.db = new dFace.RoomDB( dbPool, self.roomId );
	let dbSetts = null;
	try {
		dbSetts = await self.db.getSettings();
	} catch ( e ) {
		sLog( 'init - failed to load db settings', e );
		self.setDefaults();
	}
	
	if ( dbSetts )
		self.setDbSettings( dbSetts );
	
	return self.setting;
}

ns.ContactSettings.prototype.setDbSettings = function( settings ) {
	const self = this;
	let keys = Object.keys( settings );
	keys.forEach( add );
	self.settingStr = JSON.stringify( self.setting );
	
	function add( key ) {
		let value = settings[ key ];
		self.setting[ key ] = value;
	}
}

ns.ContactSettings.prototype.setDefaults = function() {
	const self = this;
	//self.set( 'userLimit', 0 );
	//self.set( 'isStream', false );
}


/*
	ContactLog
*/
const llLog = require( './Log' )( 'ContactRoom > Log' );
ns.ContactLog = function(
	dbPool,
	roomId,
	users,
	idCache,
	relationId
) {
	const self = this;
	self.relationId = relationId;
	components.Log.call( self,
		dbPool,
		roomId,
		users,
		idCache,
		true
	);
}

util.inherits( ns.ContactLog, components.Log );

// Public

ns.ContactLog.prototype.baseClose = ns.ContactLog.prototype.close;
ns.ContactLog.prototype.close = function() {
	const self = this;
	delete self.relationId;
	self.baseClose();
}

ns.ContactLog.prototype.get = async function( conf ) {
	const self = this;
	if ( null == conf ) {
		return await self.buildLogEvent( 'before', self.items );
	} else {
		return self.load( conf );
	}
}

ns.ContactLog.prototype.buildLogEvent = async function( type, events ) {
	const self = this;
	const relations = await self.msgDb.getRelations( self.relationId );
	const logs = {
		type : type,
		data : {
			events    : events,
			relations : relations,
		}
	};
	return logs;
}

ns.ContactLog.prototype.confirm = async function( msgId, userId ) {
	const self = this;
	if ( !msgId || !userId )
		return;
	
	let res = null;
	try {
		res = await self.msgDb.updateUserLastRead(
			self.relationId,
			userId,
			msgId
		);
	} catch( ex ) {
		llLog( 'confirm - db fail', ex );
		return false;
	}
	
	return res;
}

// Private

ns.ContactLog.prototype.persist = async function( event ) {
	const self = this;
	const item = event.data;
	item.type = event.type;
	const fromId = item.fromId;
	const other = self.users.getOther( fromId );
	const toId = other.clientId;
	try {
		await self.msgDb.setForRelation(
			item,
			self.relationId,
			toId
		);
	} catch( err ) {
		llLog( 'persist - err', err );
		return false;
	}
	
	return true;
}

//

module.exports = ns.ContactRoom;
