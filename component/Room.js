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
ns.Room = function( conf, db, onempty, onopen ) {
	const self = this;
	if ( !conf.clientId )
		throw new Error( 'Room - clientId missing' );
	
	self.id = conf.clientId;
	self.ownerId = conf.ownerId;
	self.name = conf.name || null;
	self.persistent = conf.persistent || false;
	self.dbPool = db;
	self.onempty = onempty;
	self.onopen = onopen;
	
	self.open = false;
	self.invite = null;
	self.chat = null;
	self.live = null;
	self.users = {};
	self.identities = {};
	self.onlineList = [];
	self.authorized = {};
	self.accessKey = null;
	self.roomDb = null;
	self.emptyTimeout = 1000 * 20;
	self.emptyTimer = null;
	
	self.init();
}

// Public

ns.Room.prototype.connect = function( accountId ) {
	const self = this;
	const signal = self.bindUser( accountId );
	if ( self.emptyTimer ) {
		clearTimeout( self.emptyTimer );
		self.emptyTimer = null;
	}
	
	return signal;
}

ns.Room.prototype.disconnect = function( accountId ) {
	const self = this;
	self.releaseUser( accountId );
}

// for real accounts, not for guests
ns.Room.prototype.authorizeUser = function( user ) {
	const self = this;
	const uid = self.addUser( user );
	self.persistAuthorization( uid );
}

// for guests, not for real accounts
ns.Room.prototype.addUser = function( user ) {
	const self = this;
	// add to users
	const uid = user.accountId;
	self.users[ uid ] = user;
	
	// emit to peoples
	var joinEvent = {
		type : 'join',
		data : {
			clientId : user.accountId,
			name     : user.accountName,
			avatar   : user.avatar,
			guest    : user.guest || undefined,
		},
	};
	self.broadcast( joinEvent, uid );
	return uid;
}

ns.Room.prototype.removeUser = function( accountId ) {
	const self = this;
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
	}
	self.broadcast( leave, accountId );
	if ( user.close )
		user.close();
	
	return true;
}

ns.Room.prototype.authenticateInvite = function( token ) {
	const self = this;
	return self.invite.authenticate( token );
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
	
	delete self.live;
	delete self.invite;
	delete self.chat;
	
	self.onlineList.forEach( release );
	delete self.onlineList;
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
	self.roomDb = new dFace.RoomDB( self.dbPool );
	
	self.log = new ns.Log(
		self.dbPool,
		self.id,
		self.persistent
	);
	
	self.invite = new ns.Invite(
		self.users,
		self.onlineList,
		self.dbPool
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

ns.Room.prototype.setOpen = function() {
	const self = this;
	self.open = true;
	
	if ( !self.onopen )
		return;
	
	const onopen = self.onopen;
	delete self.onopen;
	
	setTimeout( onopen, 1 );
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
		
		self.onempty();
	}
}

// room events

ns.Room.prototype.bindUser = function( userId ) {
	const self = this;
	const conf = self.users[ userId ];
	if ( !conf ) {
		log( 'bindUSer - no user for id', {
			userId : userId,
			users  : self.users,
		}, 4 );
		return null;
	}
	
	if ( conf.close ) {
		log( 'bindUser - already bound user', {
			userId : userId,
			users  : self.users,
		}, 4 );
		return conf;
	}
	
	// removing basic user obj
	delete self.users[ userId ];
	
	// add signal user obj
	const sigConf = {
		roomId      : self.id,
		roomName    : self.name,
		persistent  : self.persistent,
		accountId   : conf.accountId,
		accountName : conf.accountName,
		avatar      : conf.avatar,
		guest       : conf.guest,
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
	function goOffline( e ) { self.releaseUser( uid ); }
	function leaveRoom( e ) { self.removeUser( uid ); }
	function joinLive( e ) { self.handleJoinLive( e, uid ); }
	function leaveLive( e ) { self.handleLeaveLive( e, uid ); }
	
	// add to components
	self.invite.bind( userId );
	self.chat.bind( userId );
	
	// show online
	self.setOnline( userId );
	return user;
}

ns.Room.prototype.initialize =  function( requestId, userId ) {
	const self = this;
	const state = {
		id         : self.id,
		name       : self.name,
		ownerId    : self.ownerId,
		persistent : self.persistent,
		users      : buildBaseUsers(),
		online     : self.onlineList,
		identities : self.identities,
		peers      : self.live.peerIds,
	};
	
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
				clientId : user.accountId,
				name     : user.accountName,
				avatar   : user.avatar,
				guest    : user.guest,
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
		self.roomDb.authorize( self.id, accIds )
			.then( authSet )
			.catch( err );
	}
	
	function authSet( res ) {
		callback( true );
	}
	
	function err( err ) {
		log( 'persistRoom err', err );
		callback( null );
	}
	
	function notGuest( uid ) {
		const user = self.users[ uid ];
		return !user.guest;
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
	}
	
	function authFailed( err ) {
		log( 'persistAuthorization - authFailed', err.stack || err );
	}
}

ns.Room.prototype.revokeAuthorization = function( userId ) {
	const self = this;
	self.roomDb.revoke( self.id, userId )
	.then( revokeDone )
	.catch( revokeFailed );
	
	function revokeDone( res ) {
	}
	
	function revokeFailed( err ) {
		log( 'revokeAuthorization - err', err.stack || err );
	}
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
	// no need to release from each component, .release() is magic
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
		data : userId,
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
		guest        : user.guest,
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

const ilog = require( './Log' )( 'Room > Invite' );
ns.Invite = function( users, online, dbPool ) {
	const self = this;
	self.users = users;
	self.onlineList = online;
	
	self.publicToken = null;
	self.tokens = {};
	
	self.eventMap = null;
	
	self.init();
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

ns.Invite.prototype.authenticate = function( token ) {
	const self = this;
	if ( self.publicToken && ( token === self.publicToken ))
		return true;
	
	const hasToken = self.tokens[ token ];
	if ( !hasToken )
		return false;
	
	self.revokeToken( token );
	return true;
}

ns.Invite.prototype.close = function( callback ) {
	const self = this;
	delete self.users;
	delete self.onlineList;
	delete self.publicToken;
	delete self.tokens;
	
	if ( callback )
		callback();
}

// Private

ns.Invite.prototype.init = function() {
	const self = this;
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

ns.Invite.prototype.handle = function( event, userId ) {
	const self = this;
	var handler = self.eventMap[ event.type ];
	if ( !handler ) {
		ilog( 'no handler for ', { e : event, uid : userId });
		return;
	}
	
	handler( event.data, userId );
}

ns.Invite.prototype.handleState = function( event, userId ) {
	const self = this;
	const tokenList = Object.keys( self.tokens );
	const state = {
		type : 'state',
		data : {
			publicToken   : self.publicToken,
			privateTokens : tokenList,
			host          : self.getInviteHost(),
		},
	};
	self.send( state, userId );
}

ns.Invite.prototype.handlePublic = function( event, userId ) {
	const self = this;
	event = event || {};
	if ( !self.publicToken ) {
		const token = uuid.get( 'pub' );
		self.publicToken = token;
	}
	
	const pub = {
		type : 'public',
		data : {
			token : self.publicToken,
			host  : self.getInviteHost(),
			reqId : event.reqId || null,
		},
	};
	self.broadcast( pub );
}

ns.Invite.prototype.handlePrivate = function( event, userId ) {
	const self = this;
	event = event || {};
	const token = uuid.get( 'priv' );
	self.tokens[ token ] = token;
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

ns.Invite.prototype.handleRevoke = function( token, userId ) {
	const self = this;
	// TODO guest check here
	self.revokeToken( token );
}

ns.Invite.prototype.revokeToken = function( token ) {
	const self = this;
	if ( 'public' === token || ( self.publicToken === token ))
		revokePublic();
	else
		revoke( token );
	
	function revoke( token ) {
		if ( !self.tokens[ token ])
			return;
		
		delete self.tokens[ token ];
		broadcastRevoke( token );
	}
	
	function revokePublic() {
		self.publicToken = null;
		broadcastRevoke( 'public' );
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
		ilog( 'send - user has no .send()', user );
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
	self.db = dbPool;
	self.roomId = roomId;
	self.persistent = persistent;
	
	self.items = [];
	self.roomDb = null;
	
	self.init();
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
	
	delete self.roomDb;
	delete self.db;
}

// Private

ns.Log.prototype.init = function() {
	const self = this;
	self.msgDb = new dFace.MessageDB( self.db, self.roomId );
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

module.exports = ns.Room;
