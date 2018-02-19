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

const log = require( './Log' )( 'Room' );
const uuid = require( './UuidPrefix' )( 'msg' );
const Emitter = require( './Events' ).Emitter;
const Signal = require( './Signal' );
const dFace = require( './DFace' );
const util = require( 'util' );

var ns = {};

/* Send
	Default implementation of 
		.send()
		.broadcast()
	
*/
ns.UserSend = function( type, users, onlineList ) {
	const self = this;
	self.type = type;
	self.users = users;
	self.onlineList = onlineList;
	
	self.sendInit();
}

// 'Public'

ns.UserSend.prototype.send = function( event, userId, callback ) {
	const self = this;
	if ( !self.users ) {
		error( 'ERR_SEND_NO_USERS_OBJ' );
		return;
	}
	
	const user = self.users[ userId ];
	if ( !user ) {
		self.sendLog( 'no such user', userId );
		error( 'ERR_SEND_NO_USER');
		return;
	}
	
	if ( !user.send ) {
		self.sendLog( 'user has no .send() - not online', user, 3 );
		error( 'ERR_SEND_NOT_ONLINE' );
		return;
	}
	
	if ( self.type )
		event = {
			type : self.type,
			data : event,
		};
	
	self.sendLog( 'send', event );
	user.send( event, callback );
	
	function error( err ) {
		if ( callback )
			callback( err );
	}
}

ns.UserSend.prototype.broadcast = function( event, sourceId, wrapSource ) {
	const self = this;
	log( 'send.broadcast', self.onlineList );
	if ( !self.onlineList )
		return;
	
	if ( wrapSource )
		event = {
			type : sourceId,
			data : event,
		};
	
	self.sendLog( 'broadcast', event );
	self.onlineList.forEach( sendIfNotSource );
	function sendIfNotSource( pid ) {
		if ( pid === sourceId )
			return;
		
		self.send( event, pid );
	}
}

ns.UserSend.prototype.close = function() {
	const self = this;
	delete self.onlineList;
	delete self.users;
	delete self.type;
}

// priv

ns.UserSend.prototype.sendInit = function() {
	const self = this;
	self.sendLog = require( './Log' )( 'Room > ' + self.type );
}


/* Room


*/
ns.Room = function( conf, db ) {
	const self = this;
	if ( !conf.clientId )
		throw new Error( 'Room - clientId missing' );
	
	self.id = conf.clientId;
	self.ownerId = conf.ownerId;
	self.name = conf.name || null;
	self.persistent = conf.persistent || false;
	self.guestAvatar = conf.guestAvatar;
	self.dbPool = db;
	
	self.open = false;
	self.invite = null;
	self.chat = null;
	self.live = null;
	self.users = {};
	self.identities = {};
	self.onlineList = [];
	self.authorized = [];
	self.accessKey = null;
	self.roomDb = null;
	self.emptyTimeout = 1000 * 20;
	self.emptyTimer = null;
	
	Emitter.call( self );
	
	self.init();
}

util.inherits( ns.Room, Emitter );

// Public

// when users come online
ns.Room.prototype.connect = function( account ) {
	const self = this;
	log( 'connect', account.workgroups, 3 );
	self.processWorkgroups( account );
	const signal = self.bindUser( account );
	if ( self.emptyTimer ) {
		clearTimeout( self.emptyTimer );
		self.emptyTimer = null;
	}
	
	return signal;
}

// when user goes offline
ns.Room.prototype.disconnect = function( accountId ) {
	const self = this;
	if ( isAuthorized( accountId ))
		self.releaseUser( accountId );
	else
		self.removeUser( accountId );
	
	function isAuthorized( accId ) {
		return self.authorized.some( authId => authId === accId );
	}
}

// for real accounts, not for guests
// authorizes an account to connect to this room
ns.Room.prototype.authorizeUser = function( user, callback ) {
	const self = this;
	log( 'authorizeUser', user );
	let uid = user.accountId;
	self.persistAuthorization( uid );
	if ( callback )
		callback( null, uid );
}

// add to users list, they can now .connect()
ns.Room.prototype.addUser = function( user, callback ) {
	const self = this;
	// add to users
	log( 'addUser', user.workgroups, 3 );
	const uid = user.accountId;
	if ( self.users[ uid ]) {
		callback( null, uid );
	}
	
	self.processWorkgroups( user );
	self.users[ uid ] = user;
	
	if ( !user.avatar && !user.guest ) {
		const tinyAvatar = require( './TinyAvatar' );
		tinyAvatar.generate( user.accountName, ( err, res ) => setAvatar( res ) );
	} else
		announceUser( user );
	
	function setAvatar( png ) {
		user.avatar = png;
		announceUser( user );
	}
	
	function announceUser( user ) {
		// tell peoples
		var joinEvent = {
			type : 'join',
			data : {
				clientId   : user.accountId,
				name       : user.accountName,
				avatar     : user.avatar,
				admin      : user.admin || undefined,
				guest      : user.guest || undefined,
				workgroups : user.workgroups || undefined,
			},
		};
		self.broadcast( joinEvent, uid );
		callback( null, uid );
	}
}

// 
ns.Room.prototype.removeUser = function( accountId ) {
	const self = this;
	log( 'removeUser', accountId );
	var user = self.users[ accountId ];
	if ( !user ) {
		log( 'removeUser - invalid user', {
			aid : accountId,
			usr : self.users,
		}, 3 );
		return false;
	}
	
	// unbind / set offline
	self.releaseUser( accountId );
	
	// remove
	delete self.users[ accountId ];
	self.revokeAuthorization( accountId );
	
	// tell everyone
	const leave = {
		type : 'leave',
		data : accountId,
	};
	self.broadcast( leave, accountId );
	if ( user.close )
		user.close();
	
	return true;
}

ns.Room.prototype.authenticateInvite = async function( token ) {
	const self = this;
	const valid = await self.invite.authenticate( token );
	log( 'authenticateInvite', {
		token : token,
		valid : valid,
	});
	return valid;
}

ns.Room.prototype.close = function( callback ) {
	const self = this;
	self.open = false;
	if ( self.roomDb )
		self.roomDb.close();
	
	if ( self.live )
		self.live.close();
	
	if ( self.invite )
		self.invite.close();
	
	if ( self.chat )
		self.chat.close();
	
	if ( self.log )
		self.log.close();
	
	if ( self.worgs )
		self.worgs.close();
	
	if ( self.settings )
		self.settings.close();
	
	self.emitterClose();
	
	delete self.live;
	delete self.invite;
	delete self.chat;
	delete self.log;
	delete self.worgs;
	delete self.settings;
	
	self.onlineList.forEach( release );
	delete self.onlineList;
	delete self.authorized;
	delete self.users;
	
	delete self.dbPool;
	delete self.onempty;
	
	if ( callback )
		callback();
	
	function release( uid ) { self.releaseUser( uid ); }
}

// Private

ns.Room.prototype.init = function() {
	const self = this;
	log( 'init', self.name );
	self.roomDb = new dFace.RoomDB( self.dbPool, self.id );
	
	self.worgs = new ns.Workgroup(
		self.dbPool,
		self.id,
		self.users,
		self.onlineList,
		removeUser
	);
	log( 'worgs', self.worgs.prototype );
	self.worgs.on( 'dismissed', worgDismissed );
	self.worgs.on( 'assigned', worgAssigned );
	
	// for when a workgroup is dismissed
	function removeUser( userId ){ self.removeUser( userId ); }
	function worgDismissed( e ) { self.handleWorkgroupDismissed( e ); }
	function worgAssigned( e ) { self.emit( 'workgroup-assigned', e ); }
	
	self.settings = new ns.Settings(
		self.dbPool,
		self.id,
		self.worgs,
		self.users,
		self.onlineList,
	);
	
	self.log = new ns.Log(
		self.dbPool,
		self.id,
		self.persistent
	);
	
	self.invite = new ns.Invite(
		self.dbPool,
		self.id,
		self.users,
		self.onlineList,
		self.persistent
	);
	
	self.chat = new ns.Chat(
		self.id,
		self.users,
		self.onlineList,
		self.log
	);
	
	self.live = new ns.Live(
		self.users,
		self.onlineList
	);
	
	if ( self.persistent )
		self.loadUsers();
	else
		self.setOpen();
	
}

ns.Room.prototype.handleWorkgroupDismissed = function( worg ) {
	const self = this;
	log( 'handleWorkgroupDismissed', worg );
	self.emit( 'workgroup-dismissed', worg );
}

ns.Room.prototype.setOpen = function() {
	const self = this;
	self.open = true;
	setTimeout( emitOpen, 1 );
	function emitOpen() {
		self.emit( 'open', Date.now());
	}
}

ns.Room.prototype.loadUsers = function() {
	const self = this;
	const loading = {};
	self.roomDb.loadAuthorizations( self.id )
		.then( authBack )
		.catch( loadFailed );
	
	function authBack( rows ) {
		if ( !rows || !rows.length )
			self.setOpen();
		else
			addUsers( rows );
	}
	
	function loadFailed( err ) {
		log( 'loadAuthorizations - load failed', {
			e : err,
			s : err.stack,
		});
	}
	
	function addUsers( users ) {
		const tinyAvatar = require( './TinyAvatar' );
		users.forEach( add );
		
		function add( dbUser, index ) {
			const uid = dbUser.clientId;
			self.authorized.push( uid );
			loading[ uid ] = true;
			if ( self.users[ uid ])
				return;
			
			if ( !dbUser.avatar )
				tinyAvatar.generate( dbUser.name, ( err, res ) => setUser( res ));
			else
				setUser( dbUser.avatar );
			
			function setUser( avatar ) {
				avatar = avatar || '';
				const user = {
					accountId   : uid,
					accountName : dbUser.name,
					avatar      : avatar,
					authed      : true,
				};
				
				self.users[ uid ] = user;
				isLoaded( uid );
			}
		}
	}
	
	function isLoaded( uid ) {
		loading[ uid ] = false;
		const ids = Object.keys( loading );
		const allDone = ids.every( id => !loading[ id ] )
		if ( !allDone )
			return;
		
		self.setOpen();
	}
}

ns.Room.prototype.processWorkgroups = function( user ) {
	const self = this;
	log( 'processWorkgroups', user.workgroups );
	if ( !user.workgroups || !user.workgroups.member )
		return;
	
	const wgs = user.workgroups;
	addAvailableWorkgroups( wgs.available || wgs.member );
	user.workgroups = wgs.member.map( wg => wg.clientId );
	log( 'processWorkgroups - post', user.workgroups );
	
	function addAvailableWorkgroups( wgs ) {
		self.worgs.add( wgs );
	}
}

ns.Room.prototype.checkOnline = function() {
	const self = this;
	if ( 0 !== self.onlineList.length )
		return;
	
	if ( self.emptyTimer )
		return;
	
	self.emptyTimer = setTimeout( roomIsEmpty, self.emptyTimeout );
	function roomIsEmpty() {
		self.emptyTimer = null;
		if ( 0 !== self.onlineList.length )
			return; // someone joined during the timer. Lets not then, i guess
		
		self.emit( 'empty', Date.now());
		//self.onempty();
	}
}

// room events

ns.Room.prototype.bindUser = function( account ) {
	const self = this;
	log( 'bindUser', account );
	const userId = account.clientId;
	const conf = self.users[ userId ];
	if ( !conf ) {
		log( 'bindUSer - no user for id', {
			userId : userId,
			users  : self.users,
		}, 4 );
		return null;
	}
	
	if ( conf.close ) {
		log( 'bindUser - user already bound', {
			userId : userId,
			online  : self.onlineList,
		}, 4 );
		return conf;
	}
	
	// removing basic user obj
	delete self.users[ userId ];
	
	log( 'bindUser', conf.accountName );
	// add signal user obj
	const sigConf = {
		roomId      : self.id,
		roomName    : self.name,
		persistent  : self.persistent,
		accountId   : conf.accountId,
		accountName : conf.accountName,
		avatar      : conf.avatar,
		admin       : account.admin, // <-- using account
		authed      : account.authed || conf.authed || false,
		guest       : conf.guest,
		workgroups  : account.workgroups || conf.workgroups || [],
	};
	const user = new Signal( sigConf );
	self.users[ userId ] = user;
	
	// bind room events
	user.on( 'initialize', init );
	user.on( 'persist', persist );
	user.on( 'rename', rename );
	user.on( 'identity', identity );
	user.on( 'disconnect', goOffline );
	user.on( 'leave', leaveRoom );
	user.on( 'live-join', joinLive );
	user.on( 'live-leave', leaveLive );
	
	let uid = userId;
	function init( e ) { self.initialize( e, uid ); }
	function persist( e ) { self.handlePersist( e, uid ); }
	function rename( e ) { self.handleRename( e, uid ); }
	function identity( e ) { self.setIdentity( e, uid ); }
	function goOffline( e ) { self.disconnect( uid ); }
	function leaveRoom( e ) { self.handleLeave( uid ); }
	function joinLive( e ) { self.handleJoinLive( e, uid ); }
	function leaveLive( e ) { self.handleLeaveLive( e, uid ); }
	
	// add to components
	self.invite.bind( userId );
	self.chat.bind( userId );
	self.settings.bind( userId );
	
	// show online
	self.setOnline( userId );
	return user;
}

ns.Room.prototype.initialize =  function( requestId, userId ) {
	const self = this;
	const state = {
		id          : self.id,
		name        : self.name,
		ownerId     : self.ownerId,
		persistent  : self.persistent,
		guestAvatar : self.guestAvatar,
		users       : buildBaseUsers(),
		online      : self.onlineList,
		identities  : self.identities,
		peers       : self.live.peerIds,
		workgroups  : self.worgs.getAssigned(),
	};
	
	log( 'initalize - state', self.name );
	
	const init = {
		type : 'initialize',
		data : state,
	};
	
	self.send( init, userId );
	
	function buildBaseUsers() {
		const uIds = Object.keys( self.users );
		const users = uIds.map( build );
		return users;
		
		function build( uid ) {
			const user = self.users[ uid ];
			if ( !user )
				return undefined;
			
			return {
				clientId   : user.accountId,
				name       : user.accountName,
				avatar     : user.avatar,
				admin      : user.admin,
				authed     : user.authed,
				guest      : user.guest,
				workgroups : user.workgroups,
			};
		}
	}
}

ns.Room.prototype.handlePersist = function( event, userId ) {
	const self = this;
	if ( self.persistent )
		return;
	
	if ( !event.name || !event.name.length )
		return;
	
	self.persistent = true;
	self.name = event.name;
	self.persistRoom( persistBack );
	function persistBack( res ) {
		if ( !res )
			return;
		
		self.log.setPersistent( true );
		self.invite.setPersistent( true );
		self.onlineList.forEach( update );
		function update( userId ) {
			const user = self.users[ userId ];
			if ( !user || !user.setRoomPersistent )
				return;
			
			user.setRoomPersistent( true, event.name );
		}
	}
	
}

ns.Room.prototype.persistRoom = function( callback ) {
	const self = this;
	self.roomDb.set(
		self.id,
		self.name,
		self.ownerId
	)
		.then( roomOk )
		.catch( err );
		
	function roomOk( res ) {
		persistAuths();
	}
	
	function persistAuths() {
		const userIds = Object.keys( self.users );
		const accIds = userIds.filter( notGuest );
		self.authorized = accIds;
		self.authorized.forEach( updateClients );
		self.roomDb.authorize( self.id, accIds )
			.then( authSet )
			.catch( err );
	}
	
	function notGuest( uid ) {
		const user = self.users[ uid ];
		return !user.guest;
	}
	
	function authSet( res ) {
		log( 'authSet', res );
		callback( true );
	}
	
	function err( err ) {
		log( 'persistRoom err', err );
		callback( null );
	}
	
	function updateClients( userId ) {
		self.updateUserAuthorized( true, userId );
	}
}

ns.Room.prototype.persistAuthorization = function( userId ) {
	const self = this;
	const accIds = [ userId ];
	self.roomDb.authorize( self.id, accIds )
		.then( authorized )
		.catch( authFailed );
		
	function authorized( res ) {
		log( 'persistAuthorization - authorized', res );
		self.authorized.push( userId );
	}
	
	function authFailed( err ) {
		log( 'persistAuthorization - authFailed', err.stack || err );
	}
}

ns.Room.prototype.revokeAuthorization = function( userId, callback ) {
	const self = this;
	self.roomDb.revoke( self.id, userId )
	.then( revokeDone )
	.catch( revokeFailed );
	
	function revokeDone( res ) {
		log( 'revokeAuthorization - done', res );
		self.authorized = self.authorized.filter( uid => userId !== uid );
		if ( callback )
			callback( null, userId );
	}
	
	function revokeFailed( err ) {
		log( 'revokeAuthorization - err', err.stack || err );
		if ( callback )
			callback( err, null );
	}
}

// tell the user / client, it has been authorized for this room
ns.Room.prototype.updateUserAuthorized = function( isAuthed, userId ) {
	const self = this;
	const user = self.users[ userId ];
	user.setIsAuthed( isAuthed );
}

ns.Room.prototype.handleRename = function( name, userId ) {
	const self = this;
	if ( userId !== self.ownerId ) {
		log( 'handleRename - userId / ownerId missmatch', {
			uid : userId,
			oid : self.ownerId,
		});
		return;
	}
	
	self.name = name;
	self.roomDb.setName( self.id, name );
	self.onlineList.forEach( update );
	function update( uid ) {
		const user = self.users[ uid ];
		if ( !user || !user.setRoomPersistent )
			return;
		
		user.setRoomPersistent( true, name );
	}
}

ns.Room.prototype.setIdentity = function( id, userId ) {
	const self = this;
	if ( id.clientId !== userId ) {
		log( 'setIdentity - clientId does not match userId', {
			id     : id,
			userId : userId,
		});
		return;
	}
	const user = self.users[ userId ];
	if ( user && user.guest )
		user.accountName = id.name;
	
	self.identities[ userId ] = id;
	const uptd = {
		type : 'identity',
		data : {
			userId   : userId,
			identity : id,
		},
	};
	self.broadcast( uptd );
}

// cleans up a users signal connection to this room
ns.Room.prototype.releaseUser = function( userId ) {
	const self = this;
	var user = self.users[ userId ];
	if ( !user ) {
		log( 'releaseUser - no user', {
			u : userId,
			users : Object.keys( self.users ),
		}, 3 );
		return;
	}
	
	if ( !user.close ) // not signal, so not bound
		return;
	
	self.live.remove( userId );
	
	self.setOffline( userId );
	// no need to release each event, .release() is magic
	user.release();
	user.close();
	self.checkOnline();
}

ns.Room.prototype.setOnline = function( userId ) {
	const self = this;
	const user = self.users[ userId ];
	if ( !user )
		return null;
	
	self.onlineList.push( userId );
	const online = {
		type : 'online',
		data : {
			clientId   : userId,
			admin      : user.admin || false,
			authed     : user.authed || false,
			workgroups : user.workgroups || [],
		}
	};
	self.broadcast( online );
	return user;
}

ns.Room.prototype.setOffline = function( userId ) {
	const self = this;
	const user = self.users[ userId ];
	
	// deleteing signal
	delete self.users[ userId ];
	// adding basic obj
	self.users[ userId ] = {
		accountId    : user.accountId,
		accountName  : user.accountName,
		avatar       : user.avatar,
		admin        : user.admin,
		authed       : user.authed,
		guest        : user.guest,
		workgroups   : user.workgroups,
	};
	
	const userIndex = self.onlineList.indexOf( userId );
	if ( -1 !== userIndex ) {
		let removed = self.onlineList.splice( userIndex, 1 );
	}
	
	const offline = {
		type : 'offline',
		data : userId,
	};
	self.broadcast( offline );
	
	function isNotUid( oid ) {
		return oid !== userId;
	}
}

// peer things

ns.Room.prototype.handleLeave = function( uid ) {
	const self = this;
	log( 'handleLeave', uid );
	// check if user is authorized, if so, remove
	self.roomDb.check( uid )
		.then( authBack )
		.catch( leaveErr );
		
	function authBack( isAuthorized ) {
		if ( isAuthorized )
			self.revokeAuthorization( uid, revokeBack );
		else
			checkHasWorkgroup( uid );
	}
	
	function revokeBack( err, revokeUid ) {
		if ( err ) {
			leaveErr( err );
			return;
		}
		
		log( 'revokeBack', revokeUid );
		checkHasWorkgroup( uid );
	}
	
	function checkHasWorkgroup( uid ) {
		// check if user is in a workgroup assigned to this room
		// if so, dont close connection and move user to workgroup ( in ui )
		// else close
		const user = self.users[ uid ];
		user.authed = false;
		if ( !user )
			return;
		
		log( 'checkHasWorkgroup - user wgs', user.workgroups );
		let wgs = user.workgroups;
		if ( !wgs || !wgs.length ) {
			disconnect( uid );
			return;
		}
		
		let ass = self.worgs.getAssignedForUser( uid );
		log( 'checkhasworkgroup - user ass', ass );
		if ( !ass || !ass.length )
			disconnect( uid );
		else
			showInWorkgroup( uid, ass[ 0 ]);
	}
	
	function showInWorkgroup( uid, wg ) {
		log( 'showInworkgroup', wg );
		const authed = {
			type : 'authed',
			data : {
				userId   : uid,
				worgId   : wg,
				authed   : user.authed,
			},
		};
		self.broadcast( authed );
	}
	
	function disconnect( uid ) {
		log( 'disconnect', uid );
		self.removeUser( uid );
	}
	
	function leaveErr( err ) {
		log( 'handleLeave auth check err', err );
		self.removeUser( uid );
	}
}

ns.Room.prototype.handleJoinLive = function( event, uid ) {
	const self = this;
	var user = self.users[ uid ];
	if ( !user ) {
		log( 'handleJoinLive - no user?', {
			id : uid,
			user : user,
			users : self.users,
		});
		return;
	}
	
	self.live.add( uid );
}

ns.Room.prototype.handleLeaveLive = function( event, uid ) {
	const self = this;
	log( 'handleLeaveLive', uid );
	self.live.remove( uid );
}

// very private

ns.Room.prototype.broadcast = function( event, sourceId, wrapSource ) {
	const self = this;
	if ( wrapSource )
		event = {
			type : sourceId,
			data : event,
		};
	
	self.onlineList.forEach( sendTo );
	function sendTo( uid ) {
		if ( sourceId && uid === sourceId )
			return;
		
		self.send( event, uid );
	}
}

ns.Room.prototype.send = function( event, targetId ) {
	const self = this;
	if ( !event )
		throw new Error( 'Room.send - no event' );
	
	var user = self.users[ targetId ];
	if ( !user || !user.send ) {
		log( 'sending to offline user', {
			e : event,
			o : self.onlineList,
			u : Object.keys( self.users ),
		}, 3 );
		return;
	}
	
	user.send( event );
}

// CHAT

const clog = require( './Log' )( 'Room > Chat' );
ns.Chat = function(
	roomId,
	users,
	onlineList,
	log
) {
	const self = this;
	self.roomId = roomId;
	self.users = users;
	self.onlineList = onlineList;
	self.log = log;
	
	self.init();
}

// Public

ns.Chat.prototype.bind = function( userId ) {
	const self = this;
	const user = self.users[ userId ];
	if ( !user || !user.on ) // no .on() means its an offline user
		return;
	
	user.on( 'chat', cat );
	function cat( e ) { self.handleChat( e, userId ); }
}

ns.Chat.prototype.close = function( callback ) {
	const self = this;
	delete self.roomId;
	delete self.users;
	delete self.onlineList;
	delete self.log;
	
	if ( callback )
		callback();
}

// Private

ns.Chat.prototype.init = function() {
	const self = this;
	self.eventMap = {
		'msg'   : msg,
		'log'   : log,
		'state' : state,
	};
	
	function msg( e, uid ) { self.handleMsg( e, uid ); }
	function log( e, uid ) { self.handleLog( e, uid ); }
	function state( e, uid ) { self.handleState( e, uid ); }
}

ns.Chat.prototype.handleChat = function( event, userId ) {
	const self = this;
	var handler = self.eventMap[ event.type ];
	if ( !handler ) {
		clog( 'unknown chat event', event );
		return;
	}
	
	handler( event.data, userId );
}

ns.Chat.prototype.handleMsg = function( data, userId ) {
	const self = this;
	const user = self.users[ userId ];
	const fromId = user.guest ? null : userId;
	const message = data.message;
	const mid = uuid.get( 'msg' );
	const msg = {
		msgId   : mid,
		roomId  : self.roomId,
		fromId  : fromId,
		name    : user.accountName,
		time    : Date.now(),
		type    : 'msg',
		message : message,
	};
	
	const event = {
		type : 'msg',
		data : msg,
	};
	
	self.log.add( event );
	self.broadcast( event );
}

ns.Chat.prototype.handleLog = function( event, userId ) {
	const self = this;
	self.log.get( event )
		.then( loaded )
		.catch( logErr );
		
	function loaded( items ) {
		const log = {
			type : 'log',
			data : items,
		};
		
		self.send( log, userId );
	}
	
	function logErr( err ) {
		clog( 'handleLog - log load err', err.stack || err );
	}
}

ns.Chat.prototype.handleState = function( state, userId ) {
	const self = this;
	const event = {
		type : 'state',
		data : {
			state  : state,
			fromId : userId,
		},
	};
	self.broadcast( event, userId );
}

ns.Chat.prototype.broadcast = function( event, sourceId, wrapSource ) {
	const self = this;
	if ( wrapSource )
		event = {
			type : sourceId,
			data : event,
		};
	
	self.onlineList.forEach( sendTo );
	function sendTo( userId ) {
		if ( sourceId === userId )
			return;
		
		self.send( event, userId );
	}
}

ns.Chat.prototype.relay = function( event, targetId, sourceId ) {
	const self = this;
	clog( 'relay wahtnow?', {
		e : event,
		t : targetId,
		s : sourceId,
	});
}

ns.Chat.prototype.send = function( event, userId ) {
	const self = this;
	const user = self.users[ userId ];
	if ( !user ) {
		clog( 'send - no user for userId', {
			uid : userId,
			users : Object.keys( self.users ),
		});
		return;
	}
	
	if ( !user.send ) // no .send() means an offline user
		return;
	
	const chat = {
		type : 'chat',
		data : event,
	};
	user.send( chat );
}


// LIVE - collection of users in a live session

var llog = require( './Log' )( 'Room > Live' );
ns.Live = function( users, onlineList ) {
	const self = this;
	self.users = users;
	self.onlineList = onlineList;
	self.peers = {};
	self.peerIds = [];
	
	self.pingers = {};
	self.peerTimeouts = {};
	self.pingStep = 1000 * 5;
	self.pingTimeout = 1000 * 2;
	self.peerTimeout = 1000 * 31;
	self.peerAddTimeouts = {};
	
	self.quality = {
		level : 'medium',
		scale : 1,
	};
	self.lastScaleUpdate = null;
	
	//Emitter.call( self );
	
	self.init();
}

//util.inherits( ns.Live, Emitter );

// Public

ns.Live.prototype.add = function( userId ) {
	const self = this;
	const user = self.users[ userId ];
	if ( !user )
		return;
	
	const pid = user.accountId;
	if ( self.peers[ pid ]) {
		self.reAdd( pid );
		return;
	}
	
	self.peers[ pid ] = user;
	self.peerIds.push( pid );
	user.on( 'live', handleLive );
	
	const liveId = uuid.get( 'live' );
	user.liveId = liveId;
	// tell everyone
	self.sendJoin( pid );
	// tell peer
	self.sendOpen( pid, liveId );
	
	self.updateQualityScale();
	// tell user who else is in live
	//self.sendPeerList( pid );
	
	self.startPing( pid );
	
	function handleLive( e ) {
		self.handlePeerEvent( e, pid );
	}
}

ns.Live.prototype.remove = function( peerId ) { // userId
	const self = this;
	var peer = self.getPeer( peerId );
	if ( !peer )
		return;
	
	self.stopPing( peerId );
	// tell the peer
	self.sendClose( peerId, peer.liveId );
	peer.liveId = null;
	// tell everyone else
	self.sendLeave( peerId );
	// remove & release
	delete self.peers[ peerId ];
	self.peerIds = Object.keys( self.peers );
	peer.release( 'live' );
	self.updateQualityScale();
}

ns.Live.prototype.close = function( callback ) {
	const self = this;
	self.peerIds.forEach( remove );
	function remove( pid ) {
		self.remove( pid );
	}
	
	self.clearAddTimeouts();
	
	if ( self.speakerTimeout ) {
		clearTimeout( self.speakerTimeout );
		delete self.speakerTimeout;
	}
	
	delete self.users;
	delete self.peers;
	delete self.peerIds;
	delete self.eventMap;
	
	if ( callback )
		callback();
}

// Private

ns.Live.prototype.init = function() {
	const self = this;
	self.eventMap = {
		'pong'      : pong,
		'broadcast' : broadcast,
		'quality'   : quality,
		'speaking'  : speaking,
		'leave'     : leave,
	};
	
	function pong(      e, pid ) { self.handlePong(      e, pid ); }
	function broadcast( e, pid ) { self.handleBroadcast( e, pid ); }
	function quality(   e, pid ) { self.handleQuality(   e, pid ); }
	function speaking(  e, pid ) { self.handleSpeaking(  e, pid ); }
	function leave(     e, pid ) { self.handleLeave(     e, pid ); }
	
}

ns.Live.prototype.reAdd = function( pid ) {
	const self = this;
	if ( self.peerAddTimeouts[ pid ]){
		return; // already being re added
	}
	
	const peer = self.peers[ pid ];
	self.stopPing( pid );
	self.sendClose( pid, peer.liveId );
	peer.liveId = null;
	self.sendLeave( pid );
	delete self.peers[ pid ];
	self.peerIds = Object.keys( self.peers );
	peer.release( 'live' );
	self.peerAddTimeouts[ pid ] = setTimeout( add, 100 );
	function add() {
		delete self.peerAddTimeouts[ pid ];
		self.add( pid );
	}
}

ns.Live.prototype.clearAddTimeouts = function() {
	const self = this;
	const addTimeoutIds = Object.keys( self.peerAddTimeouts );
	if ( !addTimeoutIds.length )
		return;
	
	addTimeoutIds.forEach( clear );
	function clear( id ) {
		timeout = self.peerAddTimeouts[ id ];
		try {
			clearTimeout( timeout );
		} catch( e ) {
			// noone cares
		}
		
		delete self.peerAddTimeouts[ id ];
	}
}

ns.Live.prototype.startPing = function( pid ) {
	const self = this;
	if ( self.pingers[ pid ] )
		self.stopPing( pid );
	
	self.pingers[ pid ] = setInterval( ping, self.pingStep );
	function ping() {
		self.sendPing( pid );
	}
}

ns.Live.prototype.sendPing = function( pid ) {
	const self = this;
	var timeouts = self.peerTimeouts[ pid ];
	if ( !timeouts ) {
		self.peerTimeouts[ pid ] = {};
		timeouts = self.peerTimeouts[ pid ];
	}
	
	const timestamp = Date.now()
		.toString();
		
	const ping = {
		type : 'ping',
		data : timestamp,
	};
	self.send( ping, pid );
	timeouts[ timestamp ] = setTimeout( pingTimedOut, self.pingTimeout );
	function pingTimedOut() {
		delete timeouts[ timestamp ];
		self.startPeerTimeout( pid );
	}
}

ns.Live.prototype.startPeerTimeout = function( pid ) {
	const self = this;
	const timeouts = self.peerTimeouts[ pid ];
	if ( timeouts[ pid ] )
		return;
	
	timeouts[ pid ] = setTimeout( peerTimedOut, self.peerTimeout );
	function peerTimedOut() {
		delete timeouts[ pid ];
		self.remove( pid );
	}
}

ns.Live.prototype.stopPeerTimeout = function( pid ) {
	const self = this;
	const timeouts = self.peerTimeouts[ pid ];
	if ( !timeouts )
		return;
	
	const peerTimeout = timeouts[ pid ];
	if ( null == peerTimeout )
		return;
	
	clearTimeout( peerTimeout );
	delete timeouts[ pid ];
}

ns.Live.prototype.stopPing = function( pid ) {
	const self = this;
	const pinger = self.pingers[ pid ];
	if ( !pinger )
		return;
	
	clearInterval( pinger );
	delete self.pingers[ pid ];
	
	const timeouts = self.peerTimeouts[ pid ];
	if ( null == timeouts )
		return;
	
	const outkeys = Object.keys( timeouts );
	outkeys
		.forEach( clear );
		
	delete self.peerTimeouts[ pid ];
		
	function clear( key ) {
		const id = timeouts[ key ];
		try {
			clearTimeout( id );
		} catch ( e ) {
			// noone cares
		}
	}
}

ns.Live.prototype.handlePeerEvent = function( event, peerId ) {
	const self = this;
	// check if its a direct message to another peer ( rtc signaling )
	if ( !event ) {
		llog( 'hndlePeerEvent - not an event??', event );
		return;
	}
	
	if ( self.peers[ event.type ] ) {
		const target = event.type;
		const source = peerId;
		self.sendToTarget( event.data, source, target );
		return;
	}
	
	// no? check static event handlers
	var handler = self.eventMap[ event.type ];
	if ( handler ) {
		handler( event.data, peerId );
		return;
	}
	
	// really?
	llog( 'handlePeerEvent - no handler for', event );
}

// handlers

ns.Live.prototype.handlePong = function( timestamp, peerId ) {
	const self = this;
	const timeouts = self.peerTimeouts[ peerId ];
	if ( !timeouts )
		return;
	
	const pingout = timeouts[ timestamp ];
	if ( null == pingout )
		return;
	
	clearTimeout( pingout );
	delete timeouts[ timestamp ];
	
	// lets do something with this?
	const ping = Date.now() - parseInt( timestamp, 10 );
	
	const peerout = timeouts[ peerId ];
	if ( null == peerout )
		return;
	
	clearTimeout( peerout );
	delete timeouts[ peerId ];
}

ns.Live.prototype.handleBroadcast = function( event, peerId ) {
	const self = this;
	self.broadcast( event, peerId, true );
}

ns.Live.prototype.handleQuality = function( level, peerId ) {
	const self = this;
	self.quality.level = level;
	self.lastScaleUpdate = null;
	self.updateQualityScale();
}

ns.Live.prototype.handleSpeaking = function( event, peerId ) {
	const self = this;
	if ( false === event.isSpeaking )
		handleStoppedSpeaking( event, peerId );
	else
		handleIsSpeaking( event, peerId );
	
	function handleIsSpeaking( event, peerId ) {
		if ( null != self.speakerTimeout )
			return;
		
		self.speakerTimeout = setTimeout( clear, 1000 * 2 );
		self.currentSpeaker = peerId;
		const speaking = {
			time       : event.time,
			peerId     : peerId,
			isSpeaking : true,
		};
		send( speaking );
	}
	
	function handleStoppedSpeaking( event, peerId ) {
		if ( peerId !== self.currentSpeaker )
			return;
		
		if ( self.speakerTimeout ) {
			clearTimeout( self.speakerTimeout );
			self.speakerTimeout = null;
		}
		
		const stopped = {
			time       : event.time,
			peerId     : peerId,
			isSpeaking : false,
		};
		send( stopped );
	}
	
	function send( event ) {
		let speaking = {
			type : 'speaking',
			data : event,
		};
		self.broadcast( speaking );
	}
	
	function clear() {
		self.speakerTimeout = null;
	}
}

ns.Live.prototype.handleLeave = function( event, peerId ) {
	const self = this;
	self.remove( peerId );
}

// things

ns.Live.prototype.updateQualityScale = function() {
	const self = this;
	const peers = self.peerIds.length;
	if ( null == self.lastScaleUpdate ) {
		self.lastScaleUpdate = 0;
		self.quality.scale = recalc( peers );
		self.updateQuality();
		return;
	}
	
	//llog( 'lastScaleUpdate', self.lastScaleUpdate );
	//llog( 'peers', peers );
	const change = peers - self.lastScaleUpdate;
	//llog( 'change', change );
	let direction = ( 0 < change ) ? 1 : -1;
	//llog( 'direction', direction )
	const delta = Math.abs ( change );
	//llog( 'delta', delta );
	
	if ( !self.lastScaleDirection ) {
		//llog( 'lastScaleDirection isnt set', self.lastScaleDirection );
		self.lastScaleDirection = 1;
	}
	
	if ( self.lastScaleDirection !== direction ) {
		//llog( 'direction change', direction );
		self.lastScaleUpdate = peers - direction;
	}
	
	self.lastScaleDirection = direction;
	if ( 2 < delta ) {
		self.lastScaleUpdate = peers;
		self.quality.scale = recalc( peers );
	}
	
	self.updateQuality();
	
	function recalc( peers ) {
		var scale = 1;
		if ( 2 < peers )
			scale = 0.75;
		
		if ( 5 < peers )
			scale = 0.5;
		
		if ( 7 < peers )
			scale = 0.25;
		
		return scale;
	}
}

ns.Live.prototype.updateQuality = function() {
	const self = this;
	const quality = {
		type : 'quality',
		data : self.quality,
	};
	
	self.broadcast( quality );
}

ns.Live.prototype.sendToTarget = function( event, sourceId, targetId ) {
	const self = this;
	var msg = {
		type : sourceId,
		data : event,
	};
	self.send( msg, targetId );
}

ns.Live.prototype.sendPeerList = function( peerId ) {
	const self = this;
	const peers = {
		type : 'peers',
		data : self.peerIds,
	};
	
	if ( peerId )
		self.send( peers, peerId );
	else
		broadcast( peers );
}

ns.Live.prototype.sendJoin = function( joinedId ) {
	const self = this;
	const joined = {
		type : 'join',
		data : {
			peerId : joinedId,
			meta   : null,
		},
	};
	self.broadcastOnline( joined );
}

ns.Live.prototype.sendOpen  = function( pid, liveId ) {
	const self = this;
	const open = {
		type : 'open',
		data : {
			liveId   : liveId,
			liveConf : {
				ICE      : global.config.shared.rtc.iceServers,
				userId   : pid,
				peerList : self.peerIds,
				quality  : self.quality,
			},
		},
	};
	self.send( open, pid );
}

ns.Live.prototype.sendLeave = function( leftId ) {
	const self = this;
	const leave = {
		type : 'leave',
		data : {
			peerId : leftId,
		},
	};
	self.broadcastOnline( leave );
}

ns.Live.prototype.sendClose = function( peerId, liveId ) {
	const self = this;
	const close = {
		type : 'close',
		data : liveId,
	};
	self.send( close, peerId );
}

ns.Live.prototype.getPeer = function( peerId ) {
	const self = this;
	var peer = self.peers[ peerId ] || self.users[ peerId ] || null;
	if ( !peer ) {
		llog( 'no peer found for', {
			pid   : peerId,
			peers : self.peers,
		});
		return null;
	}
	
	return peer;
}

ns.Live.prototype.broadcast = function( data, sourceId, wrapSource ) {
	const self = this;
	if ( wrapSource )
		data = {
			type : sourceId,
			data : data,
		};
	
	self.peerIds.forEach( sendIfNotSource );
	function sendIfNotSource( pid ) {
		if ( pid === sourceId )
			return;
		
		self.send( data, pid );
	}
}

ns.Live.prototype.broadcastOnline = function( data, sourceId, wrapSource ) {
	const self = this;
	if ( wrapSource )
		data = {
			type : sourceId,
			data : data,
		};
	
	self.onlineList.forEach( sendIfNotSource );
	function sendIfNotSource( pid ) {
		if ( pid === sourceId )
			return;
		
		
		self.send( data, pid );
	}
}

ns.Live.prototype.send = function( event, targetId, callback ) {
	const self = this;
	const target = self.getPeer( targetId );
	if ( !target ) {
		llog( 'send - no peer for id', targetId );
		llog( 'send - tried to send', event );
		return;
	}
	
	if ( !target.send ) {
		llog( 'send - user is no online', target );
		llog( 'send - tried to send', event );
		return;
	}
	
	const wrap = {
		type : 'live',
		data : event,
	};
	
	target.send( wrap, callback );
}

//
// INVITE

const iLog = require( './Log' )( 'Room > Invite' );
ns.Invite = function(
		dbPool,
		roomId,
		users,
		online,
		isPersistent
) {
	const self = this;
	self.roomId = roomId;
	self.users = users;
	self.onlineList = online;
	self.isPersistent = isPersistent;
	
	self.publicToken = null;
	self.tokens = {};
	
	self.eventMap = null;
	
	self.init( dbPool, roomId );
}

// Public

ns.Invite.prototype.bind = function( userId ) {
	const self = this;
	const user = self.users[ userId ];
	if ( !user )
		return;
	
	user.on( 'invite', invite );
	function invite( e ) { self.handle( e, userId ); }
}

ns.Invite.prototype.release = function( userId ) {
	const self = this;
	const user = self.users[ userId ];
	if ( !user )
		return;
	
	user.release( 'invite' );
}

ns.Invite.prototype.authenticate = async function( token ) {
	const self = this;
	iLog( 'authenticate', token );
	iLog( 'authenticate', self.tokens );
	if ( self.publicToken && ( token === self.publicToken.value ))
		return true;
	
	const hasToken = self.tokens[ token ];
	if ( hasToken ) {
		await self.revokeToken( token );
		return true;
	}
	
	iLog( 'authenticate - check db' );
	let valid = null;
	try {
		valid = await self.checkDbToken( token );
	} catch ( e ) {
		valid = false;
	}
	
	if ( valid ) {
		await self.revokeToken( token );
	}
	
	iLog( 'authenticate - returning db result', valid );
	return valid;
}

ns.Invite.prototype.setPersistent = function( isPersistent ) {
	const self = this;
	iLog( 'setPersistent', isPersistent );
	if ( !!self.isPersistent === isPersistent )
		return;
	
	self.isPersistent = isPersistent;
	if ( !self.isPersistent )
		return;
	
	self.persistCurrentTokens()
		.then(() => {})
		.catch(() => {});
}

ns.Invite.prototype.close = function( callback ) {
	const self = this;
	if ( self.db )
		self.db.close();
	
	delete self.db;
	delete self.users;
	delete self.onlineList;
	delete self.isPersistent;
	delete self.publicToken;
	delete self.tokens;
	
	if ( callback )
		callback();
}

// Private

ns.Invite.prototype.init = function( pool, roomId ) {
	const self = this;
	self.db = new dFace.InviteDB( pool, roomId );
	self.loadPublicToken();
	
	self.eventMap = {
		'state'   : state,
		'public'  : publicSet,
		'private' : privateSet,
		'revoke'  : revoke,
	};
	
	function state( e, uid ) { self.handleState( e, uid ); }
	function publicSet( e, uid ) { self.handlePublic( e, uid ); }
	function privateSet( e, uid ) { self.handlePrivate( e, uid ); }
	function revoke( e, uid ) { self.handleRevoke( e, uid ); }
}

ns.Invite.prototype.loadPublicToken = function() {
	const self = this;
	self.db.getForRoom()
		.then( tokensBack )
		.catch( dbFail );
		
	function tokensBack( dbTokens ) {
		iLog( 'loadPublicToken - tokensBack', dbTokens );
		dbTokens.some( setPublic );
		function setPublic( dbToken ) {
			iLog( 'setPublic', dbToken );
			if ( dbToken.singleUse ) // private token
				return false;
			
			self.publicToken = {
				value : dbToken.token,
				by    : dbToken.createdBy,
			};
			
			return true;
		}
	}
	
	function dbFail( err ) {
		iLog( 'loadPublicToken - db error', err );
	}
}

ns.Invite.prototype.checkDbToken = function( token ) {
	const self = this;
	iLog( 'checkDbToken', token );
	return new Promise( tokenIsValid );
	function tokenIsValid( resolve, reject ) {
		self.db.checkForRoom( token )
			.then( isValid )
			.catch( fail );
		
		function isValid( res ) {
			iLog( 'checkDbToken.valid', res );
			if ( !res )
				resolve( false );
			else
				resolve( !!res.isValid );
		}
		
		function fail( err ) {
			iLog( 'checkDbToken.fail', err );
			reject( false );
		}
	}
}

ns.Invite.prototype.handle = function( event, userId ) {
	const self = this;
	var handler = self.eventMap[ event.type ];
	if ( !handler ) {
		iLog( 'no handler for ', { e : event, uid : userId });
		return;
	}
	
	handler( event.data, userId );
}

ns.Invite.prototype.handleState = function( event, userId ) {
	const self = this;
	const tokenList = Object.keys( self.tokens );
	const pubToken = self.publicToken || {};
	const state = {
		type : 'state',
		data : {
			publicToken   : pubToken.value,
			privateTokens : tokenList,
			host          : self.getInviteHost(),
		},
	};
	self.send( state, userId );
}

ns.Invite.prototype.handlePublic = function( event, userId ) {
	const self = this;
	event = event || {};
	if ( self.publicToken )
		returnToken( event.reqId );
	else
		setPublicToken( event.reqId, userId );
	
	function returnToken( reqId ) {
		const pub = {
			type : 'public',
			data : {
				token : self.publicToken.value,
				host  : self.getInviteHost(),
				reqId : reqId || null,
			},
		};
		self.broadcast( pub );
	}
	
	function setPublicToken( reqId, userId ) {
		iLog( 'setPublicToken', {
			reqId  : reqId,
			userId : userId,
		});
		
		self.createToken( false, userId, tokenBack );
		function tokenBack( err, token ) {
			iLog( 'handlePublic.tokenBack', {
				err   : err,
				token : token,
			});
			
			if ( err ) {
				iLog( 'setPublicToken - db error', err );
				token = null;
			}
			
			self.publicToken = {
				value : token,
				by    : userId,
			};
			returnToken( reqId );
		}
	}
}

ns.Invite.prototype.handlePrivate = function( event, userId ) {
	const self = this;
	event = event || {};
	self.createToken( true, userId, tokenBack );
	function tokenBack( err, token ) {
		iLog( 'handlePrivate.tokenBack', {
			err : err,
			token : token,
		});
		if ( token && !self.isPersistent )
			self.tokens[ token ] = {
				value : token,
				by    : userId,
			};
		
		const priv = {
			type : 'private',
			data : {
				token : token,
				host  : self.getInviteHost(),
				reqId : event.reqId || null,
			},
		};
		self.broadcast( priv );
	}
}

ns.Invite.prototype.createToken =  function( isSingleUse, createdBy, callback ) {
	const self = this;
	const pre = !isSingleUse ? 'pub' : 'priv';
	let token = uuid.get( pre );
	if ( !self.isPersistent ) {
		callback( null, token );
		return;
	}
	
	self.db.set( token, isSingleUse, createdBy )
		.then( success )
		.catch( fail );
	
	function success( res ) {
		iLog( 'createToken.trySetToken.success', res );
		callback( null, token );
	}
	
	function fail( err ) {
		iLog( 'createToken.trySetToken.fail', err );
		callback( err, null );
	}
}

ns.Invite.prototype.persistCurrentTokens = async function() {
	const self = this;
	iLog( 'persistCurrentTokens', {
		tokens : self.tokens,
		pubToken : self.publicToken,
	});
	if ( !self.isPersistent )
		return;
	
	let pubSuccess = false;
	if ( self.publicToken ) {
		let pubToken = self.publicToken;
		try {
			pubSuccess = await self.db.set( pubToken.value, false, pubToken.by );
			iLog( 'after pub await', pubSuccess );
		} catch( err ) {
			iLog( 'failed to persist public token', err );
		}
	}
	
	let privTokens = Object.keys( self.tokens );
	privTokens.forEach( persist );
	async function persist( token ) {
		let meta = self.tokens[ token ];
		iLog( 'persist', meta );
		try {
			await self.db.set( meta.value, true, meta.by );
		} catch( err ) {
			iLog( 'failed to persist private token', err );
		}
		
		delete self.tokens[ token ];
	}
}

ns.Invite.prototype.handleRevoke = function( token, userId ) {
	const self = this;
	// TODO guest check here
	self.revokeToken( token, userId )
		.then(( ok ) => iLog( 'handleRevoke', ok ));
}

ns.Invite.prototype.revokeToken = async function( token, userId ) {
	const self = this;
	iLog( 'revokeToken', token );
	let ok = false;
	if ( 'public' === token || ( self.publicToken && ( self.publicToken.value === token ) ))
		ok = await revokePublic( token, userId );
	else
		ok = await revoke( token, userId );
	
	return ok;
	
	async function revoke( token, userId ) {
		delete self.tokens[ token ];
		
		try {
			await invalidateDbToken( token, userId );
		} catch( e ) {
			iLog( 'revokeToken - failed to revoke DB token', e );
			return false;
		}
		
		broadcastRevoke( token );
		return true;
	}
	
	async function revokePublic( token, userId ) {
		if ( self.publicToken )
			token = self.publicToken.value;
		
		self.publicToken = null;
		try {
			await invalidateDbToken( token, userId );
		} catch ( e ) {
			iLog( 'revokeToken - failed to revoke DB token', e );
			return false;
		}
		
		broadcastRevoke( 'public' );
		return true;
	}
	
	function invalidateDbToken( token, userId ) {
		return self.db.invalidate( token, userId );
	}
	
	function broadcastRevoke( token ) {
		const revoke = {
			type : 'revoke',
			data : token,
		};
		self.broadcast( revoke );
	}
}

ns.Invite.prototype.getInviteHost = function() {
	const self = this;
	return global.config.shared.wsHost;
}

ns.Invite.prototype.broadcast = function( event, sourceId ) {
	const self = this;
	self.onlineList
		.forEach( sendTo );
		
	function sendTo( uid ) {
		if ( uid === sourceId )
			return;
		
		self.send( event, uid );
	}
}

ns.Invite.prototype.send = function( event, targetId ) {
	const self = this;
	const user = self.users[ targetId ];
	if ( !user )
		return;
	
	if ( !user.send ) {
		iLog( 'send - user has no .send()', user );
		return;
	}
	
	const inv = {
		type : 'invite',
		data : event,
	};
	user.send( inv );
}

//
// LOG
//

const lllog = require( './Log' )( 'Room > Log' );
ns.Log = function( dbPool, roomId, persistent ) {
	const self = this;
	self.roomId = roomId;
	self.persistent = persistent;
	
	self.items = [];
	self.msgDb = null;
	
	self.init( dbPool );
}

// Public

ns.Log.prototype.add = function( msg ) {
	const self = this;
	self.items.push( msg );
	if ( 100 < self.items.length )
		self.items = self.items.slice( -50 );
	
	if ( self.persistent )
		self.persist( msg );
	
}

ns.Log.prototype.get = function( conf ) {
	const self = this;
	return new Promise( logs );
	function logs( resolve, reject ) {
		if ( null == conf ) {
			let logs = {
				type : 'before',
				data : self.items,
			};
			resolve( logs );
		} else
			self.load( conf )
				.then( resolve )
				.catch( err );
		
		function err( err ) {
			lllog( 'load error', err.stack || err );
			resolve( null );
		}
	}
}

ns.Log.prototype.setPersistent = function( isPersistent ) {
	const self = this;
	if ( self.persistent )
		return;
	
	self.persistent = isPersistent;
	self.writeLogToDb();
}

ns.Log.prototype.close = function() {
	const self = this;
	if ( self.msgDb )
		self.msgDb.close();
	
	delete self.msgDb;
	delete self.roomId;
}

// Private

ns.Log.prototype.init = function( pool ) {
	const self = this;
	self.msgDb = new dFace.MessageDB( pool, self.roomId );
	self.load()
		.then( itemsBack )
		.catch( logErr );
		
	function itemsBack( log ) {
		self.items = log.data;
	}
	
	function logErr( err ) {
		lllog( 'init load err', err.stack || err );
	}
}

ns.Log.prototype.load = function( conf ) {
	const self = this;
	if ( !conf ) {
		conf = {};
		return new Promise( loadBefore );
	}
	
	if ( conf.lastId )
		return new Promise( loadAfter );
	else
		return new Promise( loadBefore );
	
	function loadBefore( resolve, reject ) {
		self.msgDb.getBefore( conf.firstId, conf.length )
			.then( loaded )
			.catch( loadErr );
			
		function loaded( items ) {
			let events = parse( items );
			let log = {
				type : 'before',
				data : events,
			};
			resolve( log );
		}
		
		function loadErr( e ) {
			lllog( 'loadErr', e );
			reject( e );
		}
	}
	
	function loadAfter( resolve, reject ) {
		self.msgDb.getAfter( conf.lastId, conf.length )
			.then( loaded )
			.catch( loadErr );
			
		function loaded( items ) {
			let events = parse( items );
			let log = {
				type : 'after',
				data : events,
			};
			resolve( log );
		}
		
		function loadErr( e ) {
			lllog( 'loadErr', e );
			reject( e );
		}
	}
	
	function parse( items ) {
		if ( !items )
			return null;
		
		const events = items.map( extractType );
		return events;
		
		function extractType( item ) {
			const event = {
				type : item.type,
				data : null,
			};
			delete item.type;
			event.data = item;
			return event;
		}
	}
}

ns.Log.prototype.persist = function( event ) {
	const self = this;
	let item = event.data;
	item.type = event.type;
	
	self.msgDb.set( item )
		.then( ok )
		.catch( err );
		
		function ok( res ) {
			//lllog( 'write ok', res, 4 );
		}
		
		function err( err ) {
			lllog( 'write err', err.stack || err );
		}
}

ns.Log.prototype.writeLogToDb = function() {
	const self = this;
	self.items.forEach( store );
	function store( item ) {
		self.persist( item );
	}
}


// Workgroup - always connected to a Room

let wlog = require( './Log' )( 'Room > Workgroup' );
ns.Workgroup = function( dbPool, roomId, users, onlineList, releaseUser ) {
	const self = this;
	Emitter.call( self );
	
	self.roomId = roomId;
	self.users = users;
	self.onlineList = onlineList;
	self.db = null;
	self.groups = {};
	self.ids = [];
	self.list = [];
	self.assigned = {};
	self.releaseUser = releaseUser; // callback to release user from Room
	
	self.init( dbPool );
}

util.inherits( ns.Workgroup, Emitter );

// 

ns.Workgroup.prototype.add = function( wgs ) {
	const self = this;
	if ( !wgs || !wgs.length )
		return;
	
	let added = wgs
		.map( add )
		.filter( notNull );
	
	if ( added.length )
		updateData();
	
	return added;
	
	function add( wg ) {
		if ( self.groups[ wg.clientId ] )
			return null;
		
		self.groups[ wg.clientId ] = wg;
		return wg;
	}
	
	function notNull( wg ) {
		return !!wg;
	}
	
	function updateData() {
		self.ids = Object.keys( self.groups );
		self.list = self.ids.map( wgId  => self.groups[ wgId ]);
		self.updateClients();
	}
}

ns.Workgroup.prototype.getAvailable = function() {
	const self = this;
	return self.list;
}

ns.Workgroup.prototype.setAssigned = function( dbWorgs ) {
	const self = this;
	dbWorgs.forEach( add );
	function add( wg ) {
		self.assigned[ wg.fId ] = wg;
	}
}

ns.Workgroup.prototype.getAssigned = function() {
	const self = this;
	return self.list
		.filter( isAssigned )
		.map( addInfo );
		
	function isAssigned( wg ) {
		return !!self.assigned[ wg.fId ];
	}
	
	function addInfo( wg ) {
		let ass = self.assigned[ wg.fId ];
		wg.setById = ass.setById;
		wg.setTime = ass.setTime;
		return wg;
	}
}

ns.Workgroup.prototype.getAssignedClientIds = function() {
	const self = this;
	const assigned = self.getAssigned();
	return assigned.map( item => item.clientId );
}

ns.Workgroup.prototype.getAssignedForUser = function( userId ) {
	const self = this;
	wlog( 'getAssignedForUser', userId );
	const user = self.users[ userId ];
	if ( !user ) {
		wlog( 'getAssignedfor - user', user );
		return null;
	}
	
	const uwgs = user.workgroups;
	if ( !uwgs || !uwgs.length )
		return [];
	
	const ass = self.getAssignedClientIds();
	const userAss = ass.filter( userIsMember );
	wlog( 'getAss - post', {
		uwgs : uwgs,
		ass  : ass,
		uass : userAss,
	});
	
	return userAss;
	
	function userIsMember( aId ) {
		return !!uwgs.some( cId => aId === cId );
	}
}

// Update assigned workgroups on room (item)
ns.Workgroup.prototype.updateAssigned = function( item, userId ) {
	const self = this;
	return new Promise( save );
	function save( resolve, reject ) {
	
		if ( !isValid( item, reject ))
			return;
		
		const cId = item.clientId;
		const worg = self.groups[ cId ];
		const fId = worg.fId;
		if ( true === item.value )
			assign();
		else
			dismiss();
		
		// Assign workgroup to room
		function assign() {
			if ( self.assigned[ fId ]) {
				resolve( item );
				return;
			}
			
			self.db.assignWorkgroup( fId, userId )
				.then( assigned )
				.catch( reject );
				
			function assigned( dbWorg ) {
				self.addAssigned( dbWorg );
				self.emit( 'assigned', {
					fId : fId,
					cId : cId,
				});
				resolve( dbWorg );
			}
		}
		
		// Remove workgroup from room
		function dismiss() {
			if ( !self.assigned[ fId ]) {
				resolve( fId );
				return;
			}
			
			self.db.dismissWorkgroup( fId )
				.then( dismissed )
				.catch( reject );
				
			function dismissed( res ) {
				self.removeAssigned( fId );
				self.removeUsers();
				self.emit( 'dismissed', {
					fId : fId,
					cId : cId,
				});
				resolve( res.fId );
			}
		}
		
		function isValid( item, reject ) {
			if ( !item || !item.clientId ) {
				reject( 'ERR_INVALID_DATA' );
				return false;
			}
			
			const group = self.groups[ item.clientId ];
			if ( !group ) {
				reject( 'ERR_INVALID_DATA' );
				return false;
			}
			
			return true;
		}
	}
}

ns.Workgroup.prototype.send = function( event, userId, callback ) {
	const self = this;
	if ( !self.conn ) {
		callback( 'ERR_NO_CONN', null );
		return;
	}
	
	self.conn.send( event, userId, callback );
}

ns.Workgroup.prototype.broadcast = function( event, sourceId, wrapSource ) {
	const self = this;
	if ( !self.conn )
		return;
	
	self.conn.broadcast( event, sourceId, wrapSource );
}

ns.Workgroup.prototype.close = function() {
	const self = this;
	self.emitterClose();
	
	if ( self.conn )
		self.conn.close();
	
	if ( self.db )
		self.db.close();
	
	delete self.roomId;
	delete self.conn;
	delete self.db;
	delete self.users;
	delete self.onlineList;
	delete self.groups;
	delete self.ids;
	delete self.list;
	delete self.releaseUser;
}

// private

ns.Workgroup.prototype.init = function( dbPool ) {
	const self = this;
	wlog( 'init', self.on );
	self.conn = new ns.UserSend( 'workgroup', self.users, self.onlineList );
	self.db = new dFace.RoomDB( dbPool, self.roomId );
}

ns.Workgroup.prototype.updateClients = function() {
	const self = this;
	const worgs = {
		type : 'list',
		data : self.list,
	};
	self.broadcast( worgs );
}

ns.Workgroup.prototype.addAssigned = function( dbWorg ) {
	const self = this;
	wlog( 'addAssigned', dbWorg );
	self.assigned[ dbWorg.fId ] = dbWorg;
	const update = {
		type : 'assigned',
		data : self.getAssigned(),
	};
	self.broadcast( update );
}

ns.Workgroup.prototype.removeAssigned = function( fId ) {
	const self = this;
	delete self.assigned[ fId ];
}

ns.Workgroup.prototype.removeUsers = function() {
	const self = this;
	self.onlineList.forEach( checkHasAssigned );
	function checkHasAssigned( userId ) {
		let user = self.users[ userId ];
		if ( user.authed )
			return;
		
		let assForUser = self.getAssignedForUser( userId );
		if ( !assForUser.length )
			self.releaseUser( userId );
	}
}


// Settings

const slog = require( './Log' )( 'Room > Settings' );
ns.Settings = function(
	dbPool,
	roomId,
	worgs,
	users,
	onlineList
) {
	const self = this;
	self.roomId = roomId;
	self.worgs = worgs;
	self.users = users;
	self.onlineList = onlineList;
	
	self.handlerMap = {};
	self.list = [];
	
	self.init( dbPool );
}

// Public

ns.Settings.prototype.bind = function( userId ) {
	const self = this;
	const user = self.users[ userId ];
	if ( !user || !user.on )
		return;
	
	user.on( 'settings', loadSettings );
	user.on( 'setting', saveSetting );
	
	function loadSettings( e ) { self.handleLoad( e, userId ); }
	function saveSetting( e ) { self.saveSetting( e, userId ); }
}

ns.Settings.prototype.get = function() {
	const self = this;
	// pre
	const worgs = {
		available : self.worgs.getAvailable(),
		assigned  : self.worgs.getAssignedClientIds(),
	};
	//
	const settings = {
		userLimit : self.userLimit,
		workgroups : worgs
	};
	
	return settings;
}

ns.Settings.prototype.set = function( setting, value ) {
	const self = this;
	slog( 'set', {
		s : setting,
		v : value,
	});
}

ns.Settings.prototype.send = function( event, userId, callback ) {
	const self = this;
	if ( !self.conn ) {
		callback( 'ERR_NO_CONN', null );
		return;
	}
	
	self.conn.send( event, userId, callback );
}

ns.Settings.prototype.broadcast = function( event, sourceId, wrapSource ) {
	const self = this;
	if ( !self.conn )
		return;
	
	self.conn.broadcast( event, sourceId, wrapSource );
}

ns.Settings.prototype.close = function() {
	const self = this;
	if ( self.conn )
		self.conn.close();
	
	if ( self.db )
		self.db.close();
	
	delete self.conn;
	delete self.db;
	delete self.roomId;
	delete self.worgs;
}

// Private

ns.Settings.prototype.init = function( dbPool ) {
	const self = this;
	slog( 'init' );
	self.conn = new ns.UserSend( 'settings', self.users, self.onlineList );
	self.handlerMap = {
		userLimit  : userLimit,
		workgroups : worgs,
	};
	
	function userLimit( e, uid ) { self.handleUserLimit( e, uid ); }
	function worgs( e, uid ) { self.handleWorgs( e, uid ); }
	
	self.list = Object.keys( self.handlerMap );
	
	self.db = new dFace.RoomDB( dbPool, self.roomId );
	self.db.getSettings()
		.then( settings )
		.catch( loadErr );
		
	function settings( res ) {
		self.setDbSettings( res );
		self.db.getAssignedWorkgroups()
			.then( wgs )
			.catch( loadErr );
	}
	
	function wgs( res ) {
		self.worgs.setAssigned( res );
	}
	
	function loadErr( err ) { slog( 'loadErr', err ); }
}

ns.Settings.prototype.setDbSettings = function( settings ) {
	const self = this;
	self.userLimit = settings.userLimit || 0;
}

ns.Settings.prototype.handleLoad = function( event, userId ) {
	const self = this;
	const res = self.get();
	self.send( res, userId );
}

ns.Settings.prototype.saveSetting = function( event, userId ) {
	const self = this;
	slog( 'saveSetting', {
		e : event,
		u : userId,
	});
	
	const user = self.users[ userId ];
	if ( !user )
		return;
	
	if ( !self.checkIsAdmin( event.setting, userId ))
		return;
	
	const handler = self.handlerMap[ event.setting ];
	if ( !handler ) {
		slog( 'saveSetting - no handler for ', event );
		return;
	}
	
	handler( event.value, userId );
}

ns.Settings.prototype.checkIsAdmin = function( setting, userId ) {
	const self = this;
	const user = self.users[ userId ];
	if ( !user.admin ) {
		slog( 'checkIsAdmin - user is not admin', user, 3 );
		self.sendError( 'userLimit', 'ERR_NOT_ADMIN', userId );
		return false;
	} else
		return true;
	
}

ns.Settings.prototype.handleUserLimit = function( value, userId ) {
	const self = this;
	slog( 'handleUserLimit', value );
	self.userLimit = value;
	self.sendSaved( 'userLimit', value, true, userId );
}

ns.Settings.prototype.handleWorgs = function( worg, userId ) {
	const self = this;
	slog( 'handleWorgs', {
		v : worg,
		uid : userId,
	});
	
	// Run update on worgs object (workgroup)
	self.worgs.updateAssigned( worg, userId )
		.then( done )
		.catch( error );
		
	function done( res ) {
		slog( 'handleWorgs - success' );
		send( true );
	}
	
	function error( err ) {
		slog( 'handleWorgs - fail', err );
		worg.value = !worg.value;
		send( false );
	}
	
	function send( success ) {
		self.sendSaved( 'workgroups', worg, success, userId );
	}
}

ns.Settings.prototype.sendSaved = function( setting, value, success, userId ) {
	const self = this;
	slog( 'sendSaved', {
		s : setting,
		v : value,
	});
	
	const update = {
		type : 'update',
		data : {
			success : success,
			setting : setting,
			value   : value,
		},
	};
	if ( success )
		self.broadcast( update );
	else
		self.send( update, userId );
}

ns.Settings.prototype.sendError = function( setting, errMsg, userId ) {
	const self = this;
	const fail = {
		type : 'update',
		data : {
			success : false,
			errMsg  : errMsg,
			setting : setting,
			value   : null,
		},
	};
	self.send( fail, userId );
}

module.exports = ns.Room;
