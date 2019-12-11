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

const log = require( './Log' )( 'WorkRoom' );
const uuid = require( './UuidPrefix' )( 'msg' );
const components = require( './RoomComponents' );
const FService = require( '../api/FService' );
const Signal = require( './Signal' );
const events = require( './Events' );
const dFace = require( './DFace' );
const Janus = require( './Janus' );
const Room = require( './Room' );
const util = require( 'util' );

var ns = {};

ns.WorkRoom = function( conf, db, idCache, worgCtrl ) {
	const self = this;
	self.workgroupId = conf.workgroupId;
	self.priority = conf.priority;
	
	self.super = null;
	self.superConn = null;
	self.subs = {};
	self.subIds = [];
	self.subMembers = {};
	conf.persistent = true;
	
	Room.call( self, conf, db, idCache, worgCtrl );
}

util.inherits( ns.WorkRoom, Room );

// Public

ns.WorkRoom.prototype.getWorkgroupId = function() {
	const self = this;
	return self.workgroupId || null;
}

ns.WorkRoom.prototype.getMemberList = function() {
	const self = this;
	const list = self.users.getList( self.workgroupId );
	return list;
}

ns.WorkRoom.prototype.getRoomId = function() {
	const self = this;
	return {
		clientId : self.id,
		workId   : self.workgroupId,
		superId  : self.supergroupId,
		name     : self.name,
		avatar   : self.avatar,
	};
}

ns.WorkRoom.prototype.isChild = function() {
	const self = this;
	return !!self.super;
}

ns.WorkRoom.prototype.getSuperId = function() {
	const self = this;
	return self.users.getSuper() || null;
}

ns.WorkRoom.prototype.attach = async function( subRoom ) {
	const self = this;
	const sId = subRoom.getWorkgroupId();
	self.subs[ sId ] = subRoom;
	self.subIds = Object.keys( self.subs );
	self.users.addSub( sId );
	self.bindSubRoom( sId );
	self.sendSubUpdate();
	const members = subRoom.getMemberList();
	await self.addUsers( members, sId );
	self.sendWorkMembers( sId, members );
}

ns.WorkRoom.prototype.detach = function( subId ) {
	const self = this;
	self.releaseSubRoom( subId );
	self.subIds = Object.keys( self.subs );
	self.users.removeSub( subId );
	self.sendSubUpdate();
}

ns.WorkRoom.prototype.setSuper = function( superRoom ) {
	const self = this;
	if ( !superRoom )
		throw new Error( 'WorkRoom.setSuper - no super??' );
	
	self.super = superRoom;
	const roomInfo = superRoom.getRoomId();
	self.supergroupId = roomInfo.workId;
	self.users.setSuper( roomInfo );
	self.bindSuperRoom();
}

ns.WorkRoom.prototype.unsetSuper = function() {
	const self = this;
	self.releaseSuperRoom();
	delete self.super;
	self.users.setSuper( null );
	self.supergroupId = null;
}

ns.WorkRoom.prototype.connectViewer = async function( userId ) {
	const self = this;
	if ( !self.users.checkIsViewer( userId )) {
		log( 'connectViewer - not a viewer', {
			viewers : self.users.viewers,
			user : userId,
		});
		return null;
	}
	
	return self.bindViewer( userId );
}

ns.WorkRoom.prototype.disconnect = async function( userId ) {
	const self = this;
	self.releaseUser( userId );
}

ns.WorkRoom.prototype.addViewers = async function( userList, worgId ) {
	const self = this;
	await Promise.all( userList.map( add ));
	self.users.addViewGroup( worgId );
	return true;
	
	function add( uId ) {
		return self.addUser( uId, worgId );
	}
	/*
	userList.forEach( uId => {
		self.users.addForWorkgroup( worgId, uId );
	});
	*/
}

ns.WorkRoom.prototype.addUser = async function( userId, worgId ) {
	const self = this;
	if ( !worgId )
		return false;
	
	self.users.addForWorkgroup( worgId, userId );
	if ( self.users.exists( userId ))
		return;
	
	let user = await self.idCache.get( userId );
	//if ( !self.users.exists( userId ))
	self.users.set( user );
	
	if (  worgId !== self.workgroupId )
		return userId;
	
	announce( user );
	self.onJoin( userId );
	
	return userId;
	
	function announce( user ) {
		// tell peoples
		const uId = user.clientId;
		const joinEvent = {
			type : 'join',
			data : {
				clientId   : uId,
				isAuthed   : self.checkIsAuthed( uId ),
				workgroups : self.worgs.getUserWorkgroupList( uId ),
			},
		};
		self.users.broadcast( null, joinEvent );
	}
}

ns.WorkRoom.prototype.removeUser = async function( userId, worgId ) {
	const self = this;
	if ( !self.users.exists( userId )) {
		log( 'removeUser - user not found', {
			aid : userId,
			usr : self.users.getList(),
		}, 3 );
		return false;
	}
	
	if ( !worgId ) {
		try {
			throw new Error( 'removeUSer - missing worgId' );
		} catch( e ) {
			log( 'rmeoveUser - worgId required', e );
		}
		return;
	}
	
	self.users.removeFromWorg( worgId, userId );
	const worgs = self.users.getWorgsFor( userId );
	if ( !worgs || !worgs.length )
		await remove( userId );
	else
		update( userId, worgId );
	
	if ( worgId === self.workgroupId )
		self.onLeave( userId );
	
	return true;
	
	async function remove( userId ) {
		const user = self.users.get( userId );
		await self.releaseUser( userId );
		sendLeave( userId );
		if ( user && user.close )
			user.close();
		
		self.users.remove( userId );
	}
	
	function update( userId, worgId ) {
		if ( worgId === self.workgroupId )
			sendLeave( userId );
	}
	
	// tell everyone
	function sendLeave( userId ) {
		const leave = {
			type : 'leave',
			data : userId,
		};
		self.users.broadcast( null, leave );
	}
}

ns.WorkRoom.prototype.roomClose = ns.WorkRoom.prototype.close;
ns.WorkRoom.prototype.close = function() {
	const self = this;
	self.unsetSuper();
	self.closeSubs();
	delete self.workgroupId;
	if ( self.onJoinTimeout )
		clearTimeout( self.onJoinTimeout );
	if ( self.onLeaveTimeout )
		clearTimeout( self.onLeaveTimeout );
	
	self.roomClose();
}

ns.WorkRoom.prototype.authorizeUser = async function( userId ) {
	const self = this;
	return false;
}

ns.WorkRoom.prototype.authenticateInvite = async function( token ) {
	const self = this;
	return false;
}

// Private

ns.WorkRoom.prototype.init = async function( worgCtrl ) {
	const self = this;
	self.service = new FService();
	self.roomDb = new dFace.RoomDB( self.dbPool, self.id );
	self.users = new components.Users(
		self.dbPool,
		self.id,
		self.persistent,
		self.workgroupId
	);
	await self.users.initialize();
	self.users.on( 'viewers-updated', e => self.handleViewersUpdated( e ));
	
	self.settings = new ns.WorkSettings(
		self.dbPool,
		worgCtrl,
		self.id,
		self.users,
	);
	await self.settings.initialize();
	
	self.worgs = new ns.WorkWork(
		worgCtrl,
		self.dbPool,
		self.id,
		self.workgroupId,
		self.users,
		self.settings,
	);
	await self.worgs.initialize();
	self.worgs.on( 'remove-user', removeUser );
	//self.worgs.on( 'dismissed', worgDismissed );
	//self.worgs.on( 'assigned', worgAssigned );
	
	function removeUser( e ){ self.handleRemovedFromWorgs( e ); }
	//function worgDismissed( e ) { self.handleWorkgroupDismissed( e ); }
	//function worgAssigned( e ) { self.emit( 'workgroup-assigned', e ); }
	
	self.log = new ns.WorkLog(
		self.dbPool,
		self.id,
		self.workgroupId,
		self.users,
		self.idCache,
	);
	await self.log.initialize();
	
	/*
	self.invite = new components.Invite(
		self.dbPool,
		self.id,
		self.users,
		self.persistent
	);
	*/
	
	self.chat = new ns.WorkChat(
		self.id,
		self.name,
		self.workgroupId,
		self.users,
		self.log,
		self.service
	);
	self.chat.on( 'work-msg', e => self.sendChatWorkMsg( e ));
	self.chat.on( 'msg-update', ( t, e ) => self.sendChatMsgUpdate( t, e ));
	self.chat.on( 'create-msg-for', ( w, u, i ) => {
		self.handleCreateMsgFor( w, u, i );
	});
	
	self.live = new components.Live(
		self.users,
		self.log,
		self.worgs,
		self.settings
	);
	
	//await self.loadUsers();
	self.setOpen();
}

ns.WorkRoom.prototype.loadUsers = async function() {
	const self = this;
	const worgId = self.workgroupId;
	const uList = self.worgs.getUserList( worgId );
	if ( !uList || !uList.length )
		return;
	
	await Promise.all( uList.map( add ));
	
	function add( uId ) {
		self.addUser(  uId, worgId );
	}
}

ns.WorkRoom.prototype.handleViewersUpdated = function( viewerList ) {
	const self = this;
	const joinList = viewerList.filter( uId => {
		const user = self.users.get( uId );
		if ( user && user.close )
			return false;
		
		return true;
	});
	
	self.emit( 'join-view', joinList );
}

ns.WorkRoom.prototype.handleRemovedFromWorgs = function( userId ) {
	const self = this;
	log( 'handleRemovedFromWorgs - NYI', userId );
}

ns.WorkRoom.prototype.sendChatWorkMsg = function( msg ) {
	const self = this;
	const targets = msg.targets;
	const copy = JSON.stringify( msg );
	//delete msg.targets;
	const tIds = Object.keys( targets );
	tIds.forEach( tId => {
		if ( 'all_groups' === tId ) {
			sendToAllGroups( copy );
			return;
		}
		
		if ( 'all_members' === tId ) {
			sendToAllMembers( copy );
			return;
		}
		
		const wTs = targets[ tId ];
		if ( !wTs )
			return;
		
		if ( wTs.length )
			sendToMembers( tId, wTs, copy );
		else
			sendToGroup( tId, copy );
	});
	
	function sendToAllGroups( msgStr ) {
		self.subIds.forEach( sId => {
			sendToGroup( sId, msgStr );
		});
	}
	
	function sendToGroup( wId, msgStr ) {
		let msg = JSON.parse( msgStr );
		msg.targets = {}
		msg.targets[ wId ] = true;
		sendTo( wId, msg );
	}
	
	function sendToAllMembers( msgStr ) {
		self.subIds.forEach( sId => {
			const members = self.users.getList( sId );
			sendToMembers( sId, members, msgStr );
		});
	}
	
	function sendToMembers( wId, uList, msgStr ) {
		uList.forEach( uId => {
			let msg = JSON.parse( msgStr );
			msg.targets = {};
			msg.targets[ wId ] = [ uId ];
			sendTo( wId, msg );
		});
	}
	
	function sendTo( wId, msg ) {
		if ( wId === self.supergroupId )
			self.sendSuper( 'message', msg );
		else
			self.sendSub( wId, 'message', msg );
	}
}

ns.WorkRoom.prototype.sendChatMsgUpdate = function( type, event ) {
	const self = this;
	const msgStr = JSON.stringify( event );
	const tars = event.data.targets;
	const tIds = Object.keys( tars );
	tIds.forEach( tId => {
		const t = tars[ tId ];
		sendTo( tId, t, type, msgStr );
	});
	
	function sendTo( wId, target, type, msgStr ) {
		const targets = {};
		targets[ wId ] = target;
		const msgCopy = JSON.parse( msgStr );
		msgCopy.data.targets = targets;
		const update = {
			type : type,
			data : msgCopy,
		};
		if ( wId === self.supergroupId )
			self.sendSuper( 'msg-update', update );
		else
			self.sendSub( wId, 'msg-update', update );
	}
}

ns.WorkRoom.prototype.handleCreateMsgFor = function( worgId, userId, input ) {
	const self = this;
	const bundle = {
		userId : userId,
		input  : input,
	};
	self.sendSub( worgId, 'create-msg', bundle );
}

ns.WorkRoom.prototype.handleCreateMsg = function( bundle ) {
	const self = this;
	self.chat.createWorkMsg( bundle.input, bundle.userId );
}

ns.WorkRoom.prototype.bindSubRoom = function( subId ) {
	const self = this;
	const subRoom = self.subs[ subId ];
	subRoom.on( 'message', msg => self.handleWorkMessage( subId, msg ));
	subRoom.on( 'members', list => self.handleWorkMembers( subId, list ));
	subRoom.on( 'msg-update', event => self.handleWorkMsgUpdate( subId, event ));
}

ns.WorkRoom.prototype.sendSubUpdate = function() {
	const self = this;
	const subs = {
		type : 'sub-rooms',
		data : self.subIds,
	};
	self.worgs.broadcast( subs );
}

ns.WorkRoom.prototype.sendWorkMembers = function( worgId, memberList ) {
	const self = this;
	const subRoom = self.subs[ worgId ];
	if ( null == memberList )
		throw new Error( 'needs memberList' );
	
	const members = {
		type : 'members',
		data : {
			workId  : worgId,
			members : memberList,
		},
	};
	self.worgs.broadcast( members );
}

ns.WorkRoom.prototype.sendWorkUsers = function( worgId, memberList ) {
	const self = this;
	log( 'sendWorkUsers - NYI', memberList );
}

ns.WorkRoom.prototype.handleWorkMessage = function( worgId, msg ) {
	const self = this;
	self.chat.handleWorkMsg( worgId, msg );
}

ns.WorkRoom.prototype.handleWorkMembers = function( worgId, memberList ) {
	const self = this;
	if ( worgId === self.supergroupId &&
		global.config.server.workroom.subsHaveSuperView
	) {
		self.sendWorkUsers( self.supergroupId, memberList );
		return;
	}
	
	self.sendWorkMembers( worgId, memberList );
}

ns.WorkRoom.prototype.handleWorkMsgUpdate = function( worgId, event ) {
	const self = this;
	self.chat.updateWorkMsg( worgId, event );
}

ns.WorkRoom.prototype.closeSubs = function() {
	const self = this;
	self.subIds.forEach( sId => self.releaseSubRoom( sId ));
	self.subIds = Object.keys( self.subs );
}

ns.WorkRoom.prototype.releaseSubRoom = function( subId ) {
	const self = this;
	const subRoom = self.subs[ subId ];
	delete self.subMembers[ subId ];
	delete self.subs[ subId ];
	if( !subRoom )
		return;
	
	subRoom.release( 'message' );
	subRoom.release( 'members' );
}

ns.WorkRoom.prototype.bindSuperRoom = function() {
	const self = this;
	self.superConn = new events.EventNode( self.workgroupId, self.super, superEventsink );
	self.superConn.on( 'message', msg => {
		self.handleWorkMessage( self.supergroupId, msg );
	});
	self.superConn.on( 'members', list => {
		self.handleWorkMembers( self.supergroupId, list );
	});
	self.superConn.on( 'create-msg', bundle => {
		self.handleCreateMsg( bundle );
	});
	self.superConn.on( 'msg-update', event => {
		self.handleWorkMsgUpdate( self.supergroupId, event );
	});
	
	function superEventsink( ...args ) {
		log( 'superEventSink', args, 3 );
	}
}

ns.WorkRoom.prototype.releaseSuperRoom = function() {
	const self = this;
	if ( !self.superConn )
		return;
	
	self.superConn.release();
	delete self.superConn;
}

ns.WorkRoom.prototype.sendSub = function( worgId, type, data ) {
	const self = this;
	const event = {
		type : type,
		data : data,
	};
	if ( null == worgId )
		broadcast( event );
	else
		send( worgId, event );
		
	
	function broadcast( event ) {
		self.subIds.forEach( wId => send( wId, event ));
	}
	
	function send( wId, event ) {
		self.emit( wId, event );
	}
}

ns.WorkRoom.prototype.sendSuper = function( type, data ) {
	const self = this;
	if ( !self.super )
		return;
	
	self.emit( type, data );
}

ns.WorkRoom.prototype.bindUser = async function( userId ) {
	const self = this;
	let user = self.users.get( userId );
	if ( !user ) {
		log( 'bindUSer - not a user in room', {
			roomId : self.id,
			userId : userId,
			users  : self.users,
		}, 4 );
		try {
			throw new Error( 'blah' );
		} catch( e ) {
			log( 'trace', e.stack || e );
		}
		return null;
	}
	
	if ( user.close ) {
		return user;
	}
	
	let priority = self.priority;
	if ( global.config.server.workroom.supersHaveSubRoom && self.supergroupId ) {
		if ( self.users.checkIsMemberOf( userId, self.supergroupId ))
			priority = 0;
	}
	
	// add signal user obj
	const uId = user.clientId;
	const sigConf = {
		roomId       : self.id,
		roomName     : self.name,
		roomAvatar   : self.avatar,
		isPrivate    : false,
		persistent   : true,
		workgroupId  : self.workgroupId,
		supergroupId : self.supergroupId,
		priority     : priority,
		clientId     : uId,
		name         : user.name,
		fUsername    : user.fUsername,
		avatar       : user.avatar,
		isOwner      : false,
		isAdmin      : user.isAdmin,
		isAuthed     : false,
		isGuest      : false,
	};
	user = new Signal( sigConf );
	self.users.set( user );
	
	// bind users events
	user.on( 'initialize', init );
	user.on( 'disconnect', disconnect );
	user.on( 'live-join', joinLive );
	user.on( 'live-leave', leaveLive );
	user.on( 'active', active );
	
	let uid = userId;
	function init( e ) { self.initialize( e, uid ); }
	function disconnect( e ) { self.disconnect( uid ); }
	function joinLive( e ) { self.handleJoinLive( e, uid ); }
	function leaveLive( e ) { self.handleLeaveLive( e, uid ); }
	function active( e ) { self.handleActive( e, uid ); }
	
	// add to components
	self.chat.bind( userId );
	self.settings.bind( userId );
	
	// show online
	self.users.setOnline( userId );
	return user;
}

ns.WorkRoom.prototype.bindViewer = async function( userId ) {
	const self = this;
	let user = self.users.get( userId );
	if ( !user ) {
		log( 'not user in room', userId );
		user = await self.idCache.get( userId );
	}
	
	if ( user.close )
		return user;
	
	const uId = user.clientId;
	const sigConf = {
		roomId       : self.id,
		roomName     : self.name,
		roomAvatar   : self.avatar,
		isPrivate    : false,
		isView       : true,
		persistent   : true,
		workgroupId  : self.workgroupId,
		supergroupId : self.supergroupId,
		priority     : self.priority,
		clientId     : uId,
		name         : user.name,
		fUsername    : user.fUsername,
		avatar       : user.avatar,
		isOwner      : false,
		isAdmin      : user.isAdmin,
		isAuthed     : false,
		isGuest      : false,
	};
	
	user = new Signal( sigConf );
	self.users.set( user );
	
	// bind users events
	user.on( 'initialize', init );
	user.on( 'disconnect', goOffline );
	//user.on( 'live-join', joinLive );
	//user.on( 'live-leave', leaveLive );
	user.on( 'active', active );
	
	let uid = userId;
	function init( e ) { self.initializeViewer( e, uid ); }
	function goOffline( e ) { self.disconnect( uid ); }
	function active( e ) { self.handleActive( e, uid ); }
	
	// add to components
	self.chat.bindViewer( userId );
	self.settings.bind( userId );
	
	// show online
	//self.users.setOnline( userId );
	return user;
}

ns.WorkRoom.prototype.getRoomRelation = async function( userId, isViewer ) {
	const self = this;
	const unread = await self.log.getUnreadForUser( userId, isViewer );
	let lastMessages =  null;
	if ( isViewer )
		lastMessages = self.log.getLastForView( userId, 1 );
	else
		lastMessages = self.log.getLast( userId, 1 );
	
	const relation = {
		unreadMessages : unread || 0,
		lastMessage    : lastMessages[ 0 ] || null,
	};
	
	return relation;
}

ns.WorkRoom.prototype.initialize = async function( requestId, userId ) {
	const self = this;
	const workgroups = buildWorkgroupConf();
	const relation = await self.getRoomRelation( userId );
	const state = {
		id          : self.id,
		name        : self.name,
		ownerId     : self.ownerId,
		persistent  : true,
		settings    : self.settings.get(),
		config      : global.config.server.workroom,
		guestAvatar : self.guestAvatar,
		users       : buildBaseUsers(),
		online      : self.users.getOnline(),
		peers       : self.live.peerIds,
		workgroups  : workgroups,
		relation    : relation,
	};
	
	const init = {
		type : 'initialize',
		data : state,
	};
	
	self.send( init, userId );
	
	function buildBaseUsers() {
		const users = {};
		const uIds = self.users.getList( self.workgroupId );
		uIds.forEach( build );
		return users;
		
		function build( uId ) {
			let user = self.users.get( uId );
			users[ uId ] = {
				clientId   : uId,
				isAuthed   : false,
				workgroups : self.worgs.getUserWorkgroupList( uId ),
			};
		}
	}
	
	function buildWorkgroupConf() {
		const workgroups = self.worgs.get();
		const superId = self.supergroupId;
		workgroups.superId = superId;
		workgroups.workId = self.workgroupId;
		workgroups.subIds = self.subIds;
		workgroups.members = {};
		workgroups.rooms = {};
		workgroups.users = [];
		if ( superId ) {
			const members = self.super.getMemberList();
			if ( global.config.server.workroom.subsHaveSuperView ) {
				workgroups.members[ superId ] = [];
				workgroups.users = members;
			}
			else
				workgroups.members[ superId ] = members;
			
			workgroups.rooms[ superId ] = self.super.getRoomId();
		}
		
		self.subIds.forEach( setMembers );
		return workgroups;
		
		function setMembers( sId ) {
			const sub = self.subs[ sId ];
			const subMList = sub.getMemberList();
			workgroups.members[ sId ] = subMList;
			workgroups.rooms[ sId ] = sub.getRoomId();
		}
	}
}

ns.WorkRoom.prototype.initializeViewer = async function( requestId, userId ) {
	const self = this;
	const workgroups = buildWorkgroupConf();
	const relation = await self.getRoomRelation( userId, true );
	const online = self.users.getOnline();
	const state = {
		id          : self.id,
		name        : self.name,
		ownerId     : self.ownerId,
		persistent  : true,
		settings    : self.settings.get(),
		guestAvatar : self.guestAvatar,
		users       : buildBaseUsers( userId ),
		online      : [ ...online, userId ],
		peers       : [],
		workgroups  : workgroups,
		relation    : relation,
	};
	
	const init = {
		type : 'initialize',
		data : state,
	};
	
	self.send( init, userId );
	
	function buildBaseUsers( userId ) {
		const users = {};
		build( userId );
		return users;
		
		function build( uId ) {
			let user = self.users.get( uId );
			users[ uId ] = {
				clientId   : uId,
				name       : user.name,
				avatar     : user.avatar,
				isAdmin    : user.isAdmin,
				isAuthed   : false,
				isGuest    : false,
				workgroups : self.worgs.getUserWorkgroupList( uId ),
			};
		}
	}
	
	function buildWorkgroupConf() {
		const workgroups = self.worgs.get();
		const uWorgs = self.users.getWorgsFor( userId );
		workgroups.superId = null;
		workgroups.workId = self.workgroupId;
		workgroups.subIds = uWorgs;
		workgroups.members = {};
		workgroups.rooms = {};
		uWorgs.forEach( uwId => {
			const sub = self.subs[ uwId ];
			if ( !sub )
				return;
			
			workgroups.members[ uwId ] = [ userId ];
			workgroups.rooms[ uwId ] = sub.getRoomId();
		});
		return workgroups;
	}
}

ns.WorkRoom.prototype.checkIsAuthed = function( userId ) {
	const self = this;
	return false;
}

ns.WorkRoom.prototype.onJoin = function( userId ) {
	const self = this;
	if ( self.onJoinTimeout )
		clearTimeout( self.onJoinTimeout );
	
	self.onJoinTimeout = setTimeout( sendThings, 200 );
	function sendThings() {
		self.onJoinTimeout = null;
		const memberList = self.users.getList( self.workgroupId );
		self.sendSuper( 'members', memberList );
		self.sendSub( null, 'members', memberList );
	}
}

ns.WorkRoom.prototype.onLeave = function( userId ) {
	const self = this;
	if ( self.onLeaveTimeout )
		clearTimeout( self.onLeaveTimeout );
	
	self.onLeaveTimeout = setTimeout( sendThings, 200 );
	function sendThings() {
		self.onLeaveTimeout = null;
		const memberList = self.users.getList( self.workgroupId );
		self.sendSuper( 'members', memberList );
		self.sendSub( null, 'members', memberList );
	}
}

/*
	WorkChat
*/

const cLog = require( './Log')( 'WorkRoom > Chat' );
ns.WorkChat = function(
	roomId,
	roomName,
	workgroupId,
	users,
	log,
	service
) {
	const self = this;
	self.workgroupId = workgroupId;
	components.Chat.call( self,
		roomId,
		roomName,
		users,
		log,
		service
	);
	
	self.setEventMaps();
}

util.inherits( ns.WorkChat, components.Chat );

// Public

ns.WorkChat.prototype.bindViewer = function( userId ) {
	const self = this;
	const user = self.users.get( userId );
	if ( !user || !user.on )
		return;
	
	user.on( 'chat', e => self.handleViewChat( e, userId ));
}

ns.WorkChat.prototype.handleWorkMsg = function( worgId, msg ) {
	const self = this;
	const fromId = msg.fromId;
	const superId = self.users.getSuper();
	const fromSuper = worgId === superId;
	const fromSub = !fromSuper;
	const event = {
		type : 'work-msg',
		data : msg,
	};
	
	self.log.updateCache( msg.msgId );
	self.sendWorkMsgNotification( msg );
	const targets = msg.targets[ self.workgroupId ];
	let userList = [];
	let supers = [];
	
	if ( fromSub ) {
		const roomers = self.users.getList( self.workgroupId );
		let subs = [];
		if ( global.config.server.workroom.subsHaveSuperView )
			if ( self.users.checkIsViewer( fromId ))
				subs = [ fromId ];
		
		if ( !!superId && global.config.server.workroom.supersHaveSubRoom )
			supers = self.users.getList( superId );
		
		userList = [ ...roomers, ...subs ];
	}
	
	if ( fromSuper ) {
		let roomers = [];
		if ( null == targets.length ) {
			roomers = self.users.getList( self.workgroupId );
			if ( !!superId && global.config.server.workroom.supersHaveSubRoom )
				supers = self.users.getList( superId );
		}
		else {
			if ( !global.config.server.workroom.subsHaveSuperView )
				roomers = targets;
			
			if ( !!superId && global.config.server.workroom.supersHaveSubRoom ) {
				if ( !global.config.server.workroom.supersSubHideSuper )
					supers = self.users.getList( superId );
			}
		}
		
		userList = roomers;
	}
	
	userList = [ ...userList, ...supers ];
	if ( !userList.length )
		return;
	
	self.users.broadcastChat( userList, event );
}

ns.WorkChat.prototype.updateWorkMsg = function( sourceId, update ) {
	const self = this;
	if ( !update || !update.data || !update.data.data ) {
		cLog( 'updateWorkMsg - invalid update', update );
		return;
	}
	
	const msg = update.data.data;
	const fromId = msg.fromId;
	self.log.updateCache( msg.msgId );
	const targets = msg.targets;
	const worgTarget = targets[ self.workgroupId ];
	if ( !worgTarget )
		return;
	
	if ( !worgTarget.length ) {
		self.broadcast( update );
		return;
	}
	
	worgTarget.forEach( uId => {
		self.send( update, uId );
	});
	
	if ( global.config.server.workroom.subsHaveSuperView )
		if ( self.users.checkIsViewer( fromId ))
			self.send( update, fromId );
}

// Private

ns.WorkChat.prototype.setEventMaps = function() {
	const self = this;
	self.eventMap[ 'work-msg' ] = ( e, uid ) => self.createWorkMsg( e, uid );
	self.viewMap = {
		'msg'     : ( e, uid ) => self.createMsgView( e, uid ),
		'log'     : ( e, uid ) => self.handleLogView( e, uid ),
		'state'   : ( e, uid ) => self.handleStateView( e, uid ),
		'confirm' : ( e, uid ) => self.handleConfirmView( e, uid ),
		'request' : ( e, uid ) => self.handleRequestView( e, uid ),
	};
}

ns.WorkChat.prototype.handleLog = async function( event, userId ) {
	const self = this;
	let res = await self.log.get( event );
	const superId = self.users.getSuper();
	if ( !res.data.events ) {
		sendLog( res );
		return;
	}
	
	const items = res.data.events;
	const send = items.filter( event => {
		if ( 'work-msg' !== event.type )
			return true;
		
		const msg = event.data;
		const targets = msg.targets;
		if ( !targets ) {
			cLog( 'handleLog - invalid work message, no targets', msg );
			return false;
		}
		
		const fromSuper = msg.source === superId;
		const fromRoom = msg.source === self.workgroupId;
		const fromSub = ( !fromSuper && !fromRoom );
		const fromUser = msg.fromId === userId;
		const userIsSuper = checkUserIsSuper( userId, superId );
		
		if ( fromSub ) 
			return true;
		
		if ( fromRoom ) {
			const toSuper = !!targets[ superId ];
			// to sub
			if ( !toSuper )
				return true;
			
			// to super
			
			if ( userIsSuper ) {
				if ( global.config.server.workroom.supersSubHideSuper )
					return false;
				else
					return true;
			}
			
			if ( global.config.server.workroom.subsHaveSuperView )
				return false;
			
			if ( !fromUser )
				return false;
			
			return true;
		}
		
		if ( fromSuper ) {
			const target = targets[ self.workgroupId ];
			if ( !target )
				return false;
			
			const toRoom = !target.length;
			const toUser = !toRoom ? target.some( tId => tId === userId ) : false;
			if ( toRoom )
				return true;
			
			if ( userIsSuper ) {
				if ( global.config.server.workroom.supersSubHideSuper )
					return false;
				else
					return true;
			}
			
			if ( global.config.server.workroom.subsHaveSuperView )
				return false;
			
			if ( !toUser )
				return false;
			
			return true;
		}
		
	});
	
	res.data.events = send;
	sendLog( res );
	
	function sendLog( res ) {
		const log = {
			type : 'log',
			data : res,
		};
		
		self.send( log, userId );
	}
	
	function checkUserIsSuper( uId, sId ) {
		return !!self.users.checkIsMemberOf( uId, sId );
	}
}

ns.WorkChat.prototype.handleViewChat = function( event, userId ) {
	const self = this;
	const handler = self.viewMap[ event.type ];
	if ( !handler ) {
		cLog( 'unknow chat view event', event );
		return;
	}
	
	handler( event.data, userId );
}

ns.WorkChat.prototype.createWorkMsg = async function( input, userId ) {
	const self = this;
	const message = input.message;
	let targets = input.targets;
	if ( 'string' !== typeof( input.message ))
		return;
	
	if ( !message || !message.length )
		return;
	
	if ( !targets )
		return;
	
	const user = self.users.get( userId );
	if ( !user ) {
		cLog( 'createWorkMsg - no user for', {
			uid : userId,
			users : self.users,
		}, 4 );
		return;
	}
	
	targets = expandSpecials( targets );
	const superId = self.users.getSuper();
	const mId = uuid.get( 'wrk' );
	const fromId = user.isGuest ? null : userId;
	const msg = {
		type    : 'work-msg',
		msgId   : mId,
		roomId  : self.roomId,
		fromId  : fromId,
		name    : user.name,
		time    : Date.now(),
		message : message,
		source  : self.workgroupId,
		targets : targets,
	};
	
	const event = {
		type : 'work-msg',
		data : msg,
	};
	
	await self.log.add( event );
	self.sendWorkMsgNotification( msg );
	self.emit( event.type, event.data );
	
	if ( global.config.server.workroom.subsHaveSuperView ) {
		if ( !targets[ superId ])
			self.broadcast( event );
		
		sendToViewerTargets( msg );
	}
	else
		self.broadcast( event );
	
	
	function expandSpecials( targets ) {
		const ag = 'all_groups';
		const am = 'all_members';
		if ( targets[ ag ])
			return setGroups( targets );
		
		if ( targets[ am ])
			return setMembers( targets );
		
		return targets;
	}
	
	function setGroups() {
		const targets = {};
		const subs = self.users.getSubs();
		subs.forEach( sId => {
			targets[ sId ] = true;
		});
		
		return targets;
	}
	
	function setMembers() {
		const targets = {};
		const subs = self.users.getSubs();
		subs.forEach( sId => {
			const members = self.users.getList( sId );
			if ( !members || !members.length )
				return;
			
			targets[ sId ] = members;
		});
		
		return targets;
	}
	
	function sendToViewerTargets( msg ) {
		const ts = msg.targets;
		const str = JSON.stringify( msg );
		const tIds = Object.keys( ts );
		tIds.forEach( tId => {
			const t = ts[ tId ];
			if ( !t || !t.length )
				return;
			
			t.forEach( vId => {
				const copy = JSON.parse( str );
				copy.targets = {};
				copy.targets[ tId ] = [ vId ];
				sendWork( vId, copy );
			});
		});
	}
	
	function sendWork( userId, msg ) {
		const event = {
			type : 'work-msg',
			data : msg,
		};
		self.send( event, userId );
	}
}

ns.WorkChat.prototype.sendWorkMsgNotification = async function( msg ) {
	const self = this;
	const targets = msg.targets;
	const superId = self.users.getSuper();
	const fromId = msg.fromId;
	const sender = self.users.get( msg.fromId );
	const fromRoom = msg.source === self.workgroupId;
	const fromSuper = msg.source === superId;
	const toSuper = !!targets[ superId ];
	const roomName = '#' + self.roomName;
	const notie = sender.name + ': ' + msg.message;
	const time = msg.time;
	let userIds = [];
	const extra = {
		roomId : self.roomId,
		msgId  : msg.msgId,
	};
	
	if ( fromRoom ) {
		if ( toSuper )
			return;
		
		userIds = self.users.getList( self.workgroupId );
		if ( global.config.server.workroom.subsHaveSuperView ) {
			const tIds = Object.keys( targets );
			const ts = {};
			tIds.forEach( tId => {
				const rTs = targets[ tId ];
				if ( !rTs.length )
					return;
				
				 rTs.forEach( uId => {
				 	ts[ uId ] = true;
				 });
			});
			const tUIds = Object.keys( ts );
			userIds = [ ...userIds, ...tUIds ];
		}
		
	}
	
	if ( fromSuper ) {
		const roomTargets = targets[ self.workgroupId ];
		if ( null == roomTargets.length )
			userIds = self.users.getList( self.workgroupId );
		else {
			if ( !global.config.server.workroom.subsHaveSuperView )
				userIds = roomTargets;
		}
		
	}
	
	// from sub room
	if ( !fromRoom && !fromSuper ) {
		const roomUsers = self.users.getList( self.workgroupId );
		let superUsers = [];
		if ( !!superId && global.config.server.workroom.supersHaveSubRoom )
			superUsers = self.users.getList( superId );
		
		userIds = [ ...roomUsers, ...superUsers ];
	}
	
	const userList = [];
	userIds.forEach( toId => {
		if ( fromId === toId )
			return;
		
		const user = self.users.get( toId );
		if ( !user || !user.fUsername ) {
			cLog( 'no user??', {
				uid   : toId,
				users : self.users,
			}, 4 );
			return;
		}
		
		userList.push( user.fUsername );
	});
	
	if ( !userList.length )
		return;
	
	try {
		await self.service.sendNotification(
			userList,
			roomName,
			notie,
			extra.roomId,
			time,
			extra
		);
	} catch ( err ) {
		cLog( 'sendWorkMsgNotification - err', err );
	}
}

ns.WorkChat.prototype.createMsgView = function( input, userId ) {
	const self = this;
	const isViewer = self.users.checkIsViewer( userId );
	if ( !isViewer )
		return;
	
	const wgs = self.users.getSubsFor( userId );
	if ( !wgs || !wgs.length )
		return;
	
	const uWg = wgs[ 0 ];
	const targets = {};
	targets[ self.workgroupId ] = true;
	input.targets = targets;
	self.emit( 'create-msg-for', uWg, userId, input );
	
}

ns.WorkChat.prototype.handleLogView = async function( event, userId ) {
	const self = this;
	const res = await self.log.getForView( event, userId );
	send( res );
	
	/*
	let res = await self.log.get( event );
	let items = res.data.events;
	const userWgs = self.users.getSubsFor( userId );
	if ( items && items.length )
		items = items
			.filter( hasViewerFromOrTarget )
			.map( rewriteForViewer );
	
	res.data.events = items;
	send( res );
	
	function hasViewerFromOrTarget( item ) {
		const msg = item.data;
		if ( msg.fromId === userId )
			return true;
		
		const t = msg.targets;
		if ( !t )
			return false;
		
		const isTarget = userWgs.some( uwId => {
			const uwt = t[ uwId ];
			if ( !uwt || !uwt.length )
				return false;
			
			return uwt.some( utId => utId === userId );
		});
		
		return isTarget;
	}
	
	function rewriteForViewer( item ) {
		const str = JSON.stringify( item );
		const copy = JSON.parse( str );
		const t = copy.data.targets;
		const targets = {};
		userWgs.forEach( uwId => {
			const uwt = t[ uwId ];
			if ( !uwt || !uwt.length )
				return;
			
			if ( !uwt.some( utId => utId === userId ))
				return;
			
			targets[ uwId ] = [ userId ];
		});
		copy.data.targets = targets;
		return copy;
	}
	
	*/
	function send( log ) {
		const event = {
			type : 'log',
			data : log,
		};

		self.send( event, userId );
	}
}

ns.WorkChat.prototype.handleStateView = function( event, userId ) {
	const self = this;
	self.handleState( event, userId );
	
}

ns.WorkChat.prototype.handleConfirmView = function( event, userId ) {
	const self = this;
	self.handleConfirm( event, userId );
	
}

ns.WorkChat.prototype.handleRequestView = async function( event, userId ) {
	const self = this;
	return self.handleRequest( event, userId );
}

ns.WorkChat.prototype.broadcastEdit = async function( type, eventId ) {
	const self = this;
	const event = await self.log.getEvent( eventId );
	const fromId = event.data.fromId;
	const targets = event.data.targets;
	const viewers = [];
	if ( self.users.checkIsViewer( fromId ))
		viewers.push( fromId );
	
	if ( targets && global.config.server.workroom.subsHaveSuperView ) {
		const superId = self.users.getSuper();
		const tIds = Object.keys( targets );
		tIds.forEach( tId => {
			if ( tId === superId )
				return;
			
			const target = targets[ tId ];
			if ( !target || !target.length )
				return;
			
			target.forEach( uId => {
				viewers.push( uId );
			});
		});
	}
	
	const update = {
		type : type,
		data : event,
	};
	self.broadcast( update, null, null, viewers );
	if ( targets )
		self.emit( 'msg-update', type, event );
}

ns.WorkChat.prototype.broadcast = function( event, sourceId, wrapSource, viewers ) {
	const self = this;
	let userList = null;
	if ( viewers ) {
		const online = self.users.getOnline();
		userList = [ ...online, ...viewers ];
	}
	
	self.users.broadcastChat( userList, event, sourceId, wrapSource );
}

/*
	WorkLog
*/
const llLog = require( './Log' )( 'WorkRoom > Log' );
ns.WorkLog = function(
	dbPool,
	roomId,
	worgId,
	users,
	idCache
) {
	const self = this;
	self.workgroupId = worgId;
	components.Log.call(
		self,
		dbPool,
		roomId,
		users,
		idCache,
		true
	);
}

util.inherits( ns.WorkLog, components.Log );

// Public

ns.WorkLog.prototype.getLast = function( userId, num ) {
	const self = this;
	if ( !self.items || !self.items.length )
		return [];
	
	const superId = self.users.getSuper();
	let log = [];
	let index = self.items.length;
	// filter starting with last log item
	for( ; index; ) {
		if ( log.length === num )
			break;
		
		--index;
		const item = self.items[ index ];
		if ( 'work-msg' != item.type ) {
			log.push( item );
			continue;
		}
		
		const msg = item.data;
		const targets = msg.targets;
		if ( !targets ) {
			llLog( 'getLast - invalid work-msg, no targets', msg );
			continue;
		}
		
		const fromSuper = ( msg.source === superId );
		const fromRoom = msg.source === self.workgroupId;
		const fromSub = ( !fromSuper && !fromRoom );
		const roomTargets = targets[ self.workgroupId ];
		const toRoom = ( roomTargets && !roomTargets.length );
		const toUser = checkRoomUserTarget( userId, roomTargets );
		const userIsSuper = checkUserIsSuper( userId, superId );
		if ( fromSuper ) {
			if ( toRoom ) {
				log.push( item );
				continue;
			}
			
			// to users
			if ( userIsSuper && !global.config.server.workroom.supersSubHideSuper ) {
				log.push( item );
				continue;
			}
			
			if ( global.config.server.workroom.subsHaveSuperView )
				continue;
			
			if ( toUser ) {
				log.push( item );
				continue;
			} else {
				// to other user(s)
			}
			
			continue;
		}
		
		const superTarget = targets[ superId ];
		const toSuper = !!superTarget;
		const fromUser = msg.fromId === userId;
		if ( fromRoom ) {
			if ( toSuper ) {
				if ( userIsSuper && !global.config.server.workroom.supersSubHideSuper ) {
					log.push( item );
					continue;
				}
				
				if ( global.config.server.workroom.subsHaveSuperView )
					continue;
				
				if ( !fromUser )
					continue;
				
				log.push( item );
				continue;
				
			} else {
				// to subroom
				log.push( item );
			}
			continue;
		}
		
		if ( fromSub ) {
			log.push( item );
			continue;
		}
	}
	
	return log;
	
	function checkUserIsSuper( uId, sId ) {
		return !!self.users.checkIsMemberOf( uId, sId );
	}
	
	function checkRoomUserTarget( uId, rTs ) {
		if ( !rTs || !rTs.length )
			return false;
		
		return rTs.some( tId => tId === uId );
	}
}

ns.WorkLog.prototype.getLastForView = function( userId, num ) {
	const self = this;
	if ( !self.items || !self.items.length )
		return [];
	
	const superId = self.users.getSuper();
	const log = [];
	let index = self.items.length;
	// filter starting with last log item
	for( ; index; ) {
		if ( log.length === num )
			break;
		
		--index;
		const item = self.items[ index ];
		if ( 'work-msg' != item.type ) {
			continue;
		}
		
		const msg = item.data;
		const targets = msg.targets;
		if ( !targets )
			continue;
		
		if ( msg.fromId === userId ) {
			log.push( item );
			continue;
		}
		
		const tIds = Object.keys( targets );
		let isTarget = tIds.some( tId => {
			const roomTarget = targets[ tId ];
			if ( !roomTarget || !roomTarget.length )
				return false;
			
			return roomTarget.some( uId => uId === userId );
		});
		
		if ( !isTarget )
			continue;
		
		log.push( item );
	}
	
	return log;
}

ns.WorkLog.prototype.getForView = async function( conf, userId ) {
	const self = this;
	if ( !conf )
		conf = {
			firstTime : Date.now(),
		};
	
	if ( conf.firstTime )
		return await self.loadBeforeView( conf, userId );
	else
		return await self.loadAfterView( conf, userId );
}

ns.WorkLog.prototype.getUnreadForUser = async function( userId, isViewer ) {
	const self = this;
	const unread = await self.msgDb.getRoomUserMessagesUnreadWorg(
		userId,
		self.workgroupId,
		global.config.server.workroom.subsHaveSuperView,
		isViewer || false
	);
	return unread;
}

ns.WorkLog.prototype.getEvent = async function( eId ) {
	const self = this;
	let res = await self.msgDb.getWithTargets( eId );
	return res;
}

ns.WorkLog.prototype.baseClose = ns.WorkLog.prototype.close;
ns.WorkLog.prototype.close = function() {
	const self = this;
	self.baseClose();
}

// Private

ns.WorkLog.prototype.load = function( conf ) {
	const self = this;
	if ( !conf ) {
		conf = {};
		return self.loadBefore( conf, self.workgroupId );
	}
	
	if ( conf.lastTime )
		return self.loadAfter( conf, self.workgroupId );
	else
		return self.loadBefore( conf, self.workgroupId );
}

ns.WorkLog.prototype.loadBeforeView = async function( conf, userId ) {
	const self = this;
	let items = null;
	items = await self.msgDb.getForView(
		self.workgroupId,
		userId,
		conf.firstTime,
		null,
		conf.length
	);
	
	return await self.buildLogEvent( 'before', items );
}

ns.WorkLog.prototype.loadAfterView = async function( conf, userId ) {
	const self = this;
	let items = null;
	items = await self.msgDb.getAfterView(
		self.workgroupId,
		userId,
		null,
		conf.lastTime,
		conf.length
	);
	
	return await self.buildLogEvent( 'after', items );
}

ns.WorkLog.prototype.getUnknownIdentities = async function( events ) {
	const self = this;
	if ( !events || !events.length )
		return null;
	
	const unknownIds = {};
	const start = Date.now();
	await Promise.all( events.map( check ));
	const end = Date.now();
	const total = end - start;
	/*
	llLog( 'getUnknwon completed in ( ms ):', {
		length : events.length,
		time   : total,
		start  : start,
		end    : end,
		unown  : Object.keys( unknownIds ),
	}, 3 );
	*/
	return unknownIds;
	
	async function check( event ) {
		const msg = event.data;
		let uId = msg.fromId;
		let targets = msg.targets;
		if ( uId )
			await checkUser( uId );
		
		if ( targets )
			await checkTargets( targets );
		
		return true;
	}
	
	async function checkTargets( targets ) {
		const tIds = Object.keys( targets );
		await Promise.all( tIds.map( checkTarget ));
		async function checkTarget( tId ) {
			const target = targets[ tId ];
			if ( !target || ( target === true ))
				return;
			
			await Promise.all( target.map( checkUser ));
		}
	}
	
	async function checkUser( uId ) {
		if ( unknownIds[ uId ])
			return;
		
		let user = self.users.get( uId );
		if ( user )
			return;
		
		unknownIds[ uId ] = true;
		let id = await self.idCache.get( uId );
		unknownIds[ uId ] = id;
		return;
	}
}

//

/*
	WorkWork
*/

const wLog = require( './Log')( 'WorkRoom > Workgroups' );
ns.WorkWork = function(
	worgCtrl,
	dbPool,
	roomId,
	worgId,
	users,
	settings
) {
	const self = this;
	self.workgroupId = worgId;
	components.Workgroup.call( self,
		worgCtrl,
		dbPool,
		roomId,
		users,
		settings
	);
}

util.inherits( ns.WorkWork, components.Workgroup );

ns.WorkWork.prototype.getAssigned = function() {
	const self = this;
	return [];
}

ns.WorkWork.prototype.getUserList = function() {
	const self = this;
	return self.worgCtrl.getUserList( self.workgroupId );
}

ns.WorkWork.prototype.handleUsersRemoved = function( worgId, removed ) {
	const self = this;
	if ( worgId != self.workgroupId )
		return;
	
	removed.forEach( uId => {
		self.emit( 'remove-user', uId );
	});
}

ns.WorkWork.prototype.init = async function( dbPool ) {
	const self = this;
	self.db = new dFace.RoomDB( dbPool, self.roomId );
	self.onWorgAddId = self.worgCtrl.on( 'added', worg =>
		self.handleWorgAdded( worg ));
	self.onWorgRemoveId = self.worgCtrl.on( 'removed', worg =>
		self.handleWorgRemoved( worg ));
	
	//self.setAssigned( assigned );
	//self.updateSettings();
}

ns.WorkWork.prototype.updateSettings = function() {
	const self = this;
	return;
}

ns.WorkWork.prototype.removeUsers = function() {
	
}

/*
	WorkSettings
*/

const sLog = require( './Log' )( 'WorkRoom > Settings' );
ns.WorkSettings = function(
	dbPool,
	worgCtrl,
	roomId,
	users,
) {
	const self = this;
	components.Settings.call( self,
		dbPool,
		worgCtrl,
		roomId,
		users,
		true,
		null,
	);
}

util.inherits( ns.WorkSettings, components.Settings );

ns.WorkSettings.prototype.init = async function( dbPool, ignore ) {
	const self = this;
	self.handlerMap = {
	};
	
	self.list = Object.keys( self.handlerMap );
	self.db = new dFace.RoomDB( dbPool, self.roomId );
	let dbSetts = null;
	try {
		dbSetts = await self.db.getSettings();
	} catch( err ) {
		sLog( 'init - db err', dbSetts );
		self.setDefaults();
	}
	
	if ( dbSetts )
		self.setDbSettings( dbSetts );
	
	self.events = new events.RequestNode( null, onSend, sSink, true, true );
	self.events.on( 'get', ( ...args ) => {
		return self.handleLoad( ...args );
	});
	self.events.on( 'save', ( ...args ) => {
		return self.saveSettings( ...args );
	});
	self.events.on( 'setting', ( ...args ) => self.saveSetting( ...args ));
	
	return self.setting;
	
	function onSend( event, userId ) {
		if ( userId )
			self.send( event, userId );
		else
			self.broadcast( event );
	}
	
	function sSink( ...args ) {
		sLog( 'sSink', args );
	}
}

ns.WorkSettings.prototype.setDbSettings = function( settings ) {
	const self = this;
	let keys = Object.keys( settings );
	keys.forEach( add );
	self.settingStr = JSON.stringify( self.setting );
	
	function add( key ) {
		let value = settings[ key ];
		self.setting[ key ] = value;
	}
}

ns.WorkSettings.prototype.setDefaults = function() {
	const self = this;
	//self.set( 'userLimit', 0 );
	//self.set( 'isStream', false );
}

ns.WorkSettings.prototype.handleLoad = async function( event, userId ) {
	const self = this;
	return {};
}

module.exports = ns.WorkRoom;
