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

const log = require( './Log')( 'NoMansLand' );
const TCPPool = require( './TCPPool' );
const WSPool = require( './WSPool' );
const Session = require( './Session' );
const Account = require( './Account' );
const Guest = require( './GuestAccount' );
const dFace = require( './DFace' );
const uuid = require( './UuidPrefix')();

var ns = {};

ns.NoMansLand = function( dbPool, roomCtrl, fcReq ) {
	const self = this;
	self.dbPool = dbPool;
	self.roomCtrl = roomCtrl;
	self.fcReq = fcReq;
	
	self.tcpPool = null;
	self.wsPool = null;
	self.connections = {};
	self.sessions = {};
	self.accounts = {};
	self.authTimeoutMS = 1000 * 20; // 20 sec
	
	self.init();
}

ns.NoMansLand.prototype.init = function() {
	const self = this;
	self.accEventMap = {
		'create' : createAccount,
		'login'  : doLogin,
	};
	
	function createAccount( e, cid ) { self.createAccount( e, cid ); }
	function doLogin( e, cid ) { self.clientLogin( e, cid ); }
	
	self.tcpPool = new TCPPool( onClient );
	self.wsPool = new WSPool( onClient );
	self.accDb = new dFace.AccountDB( self.dbPool );
	
	function onClient( e ) { self.handleClient( e ); }
}

ns.NoMansLand.prototype.close = function() {
	const self = this;
	self.connIds.forEach( closeClient );
	self.connections = {};
	delete self.db;
	delete self.roomCtrl;
	delete self.fcReq;
	
	function closeClient( id ) {
		self.connections[ id ].close();
	}
}

ns.NoMansLand.prototype.handleClient = function( client ) {
	const self = this;
	client.on( 'close', clientClosed );
	client.on( 'authenticate', checkAuth );
	client.on( 'session', checkSession );
	
	// send authentication challenge
	var auth = {
		type : 'authenticate',
	};
	client.sendCon( auth );
	
	// close connection if theres no auth reply within timeout
	var authTimeout = setTimeout( authTimedOut, self.authTimeoutMS );
	function authTimedOut() {
		log( 'client auth timeout hit' );
		authTimeout = null;
		client.release();
		client.close();
	}
	
	// oopsie?
	function clientClosed( e ) {
		log( 'client closed during auth timeout' );
		if ( authTimeout )
			clearTimeout( authTimeout );
		
		client.release();
	}
	
	// got auth, next step
	function checkAuth( bundle ) {
		if ( authTimeout )
			clearTimeout( authTimeout );
		
		client.release(); // remove all event handlers before handing it off
		const cid = self.addClient( client );
		self.checkClientAuth( bundle, cid );
	}
	
	function checkSession( sid ) {
		if ( authTimeout )
			clearTimeout( authTimeout );
		
		client.release();
		const cid = self.addClient( client );
		self.restoreSession( sid, cid );
	}
}

ns.NoMansLand.prototype.checkClientAuth = function( auth, cid ) {
	const self = this;
	// invite is special; anon/guest login
	if ( 'anon-invite' === auth.type ) {
		self.checkInvite( auth.data, cid );
		return;
	}
	
	self.validate( auth, authBack );
	function authBack( err, res ) {
		self.setClientAuthenticated( !err, cid );
		if ( err ) {
			self.removeClient( cid );
			return;
		}
		
		self.setClientAccountStage( res, cid );
	}
}

ns.NoMansLand.prototype.checkInvite = function( bundle, cid ) {
	const self = this;
	self.roomCtrl.authorizeGuestInvite( bundle.tokens, authBack );
	function authBack( roomId ) {
		self.setClientAuthenticated( !!roomId, cid );
		if ( !roomId ) {
			self.removeClient( cid );
			return;
		}
		
		self.loginGuest( bundle.identity, roomId, cid );
	}
}

ns.NoMansLand.prototype.loginGuest = function( identity, roomId, cid ) {
	const self = this;
	const client = self.getClient( cid );
	if ( !client )
		return;
	
	// session
	const accId = uuid.get( 'guest' );
	const session = self.createSession( accId );
	self.addToSession( session.id, cid );
	
	// guest account
	const accConf = {
		id       : accId,
		roomId   : roomId,
		identity : identity,
	};
	const account = new Guest(
		accConf,
		session,
		self.roomCtrl
	);
	self.setAccount( account );
	self.sendReady( cid );
}

ns.NoMansLand.prototype.setClientAuthenticated = function( success, cid, callback ) {
	const self = this;
	const client = self.getClient( cid );
	if ( !client )
		return;
	
	const auth = {
		type : 'authenticate',
		data : success || false,
	};
	client.sendCon( auth, callback );
}

ns.NoMansLand.prototype.setClientAccountStage = function( auth, cid ) {
	const self = this;
	const client = self.getClient( cid );
	if ( !client ) {
		self.removeClient( cid );
		return;
	}
	
	client.auth = auth;
	client.on( 'msg', handleE );
	
	// send account challenge
	const accE = {
		type : 'account',
		data : null,
	};
	client.send( accE );
	
	function handleE( e ) { self.handleAccountEvent( e, cid ); }
}

ns.NoMansLand.prototype.sendReady = function( cid ) {
	const self = this;
	const client = self.getClient( cid );
	if ( !client )
		return;
	
	const ready = { 
		type : 'ready',
		
	}
	client.send( ready );
}

ns.NoMansLand.prototype.handleAccountEvent = function( event, clientId ) {
	const self = this;
	const handler = self.accEventMap[ event.type ];
	if ( handler ) {
		handler( event.data, clientId );
		return;
	}
	
	log( 'unknown msg', event );
}

ns.NoMansLand.prototype.unsetClientAccountStage = function( cid ) {
	const self = this;
	var client = self.getClient( cid );
	if ( !client )
		return;
	
	client.auth = null;
	client.release( 'msg' );
}

ns.NoMansLand.prototype.createAccount = function( bundle, cid ) {
	const self = this;
	if ( !bundle.login
		|| !bundle.login.length
		|| !bundle.name
		|| !bundle.name.length
	) {
		createFailed( 'ERR_ACCOUNT_CREATE_MISSING', bundle );
		return;
	}
	
	var client = self.getClient( cid );
	self.accDb.get( bundle.login )
		.then( accBack )
		.catch( accSad );
	
	function accBack( data ) {
		if ( data ) {
			// account exists
			var login = {
				type : 'account',
				data : {
					type : 'login',
					data : null,
				},
			};
			client.send( login );
			return;
		}
		
		doCreate();
	}
	
	function accSad( err ) {
		createFailed( err, bundle );
	}
	
	function doCreate() {
		self.accDb.set( bundle.login, bundle.pass, bundle.name )
			.then( accCreated )
			.catch( accSad );
	}
	
	function accCreated( res ) {
		var created = {
			type : 'account',
			data : {
				type : 'create',
				data : res,
			},
		};
		client.send( created );
	}
	
	function createFailed( errCode, data ) {
		log( 'createFailed', {
			errCode : errCode,
			data    : data,
		}, 3 );
		
		var fail = {
			type : 'error',
			data : {
				error : errCode,
				data : data,
			},
		};
		client.send( fail, sent );
		function sent( err ){
			self.removeClient( cid );
		}
	}
}

ns.NoMansLand.prototype.clientLogin = function( identity, cid ) {
	const self = this;
	if ( !identity || !identity.alias ) {
		loginFailed( 'ERR_NO_LOGIN', identity );
		return
	}
	const login = identity.alias;
	const client = self.getClient( cid );
	if ( !client.auth || client.auth.login !== login ) {
		loginFailed( 'ERR_LOGIN_IDENTITY_MISMATCH', {
			clogin : client.auth.login,
			ilogin : login,
		});
		return;
	}
	
	self.accDb.get( client.auth.login )
		.then( accBack )
		.catch( accSad );
	
	function accBack( data ) {
		if ( !data ) {
			// no account for that login, tell client to create account
			var create = {
				type : 'account',
				data : {
					type : 'create',
					data : null,
				},
			};
			let client = self.getClient( cid );
			client.send( create );
		} else
			doLogin( data );
	}
	
	function accSad( err ){
		loginFailed( err, identity );
	}
	
	function doLogin( acc ) {
		let client = self.getClient( cid );
		acc.auth = client.auth;
		acc.identity = identity;
		self.unsetClientAccountStage( cid );
		const account = self.getAccount( acc.clientId );
		if ( account && !account.session ) {
			// somethings funky,
			// in the process of logging in/out?
			loginFailed( 'ERR_ACCOUNT_NO_SESSION', acc );
			return;
		}
		
		if ( account )// already logged in
			self.addToSession( account.session.id, cid );
		else
			self.setupAccount( acc, cid );
		
		self.sendReady( cid );
	}
	
	function loginFailed( errCode, data ) {
		log( 'loginFailed', errCode.stack || errCode );
		const fail = {
			type : 'error',
			data : {
				error : errCode,
				data : data,
			},
		};
		let client = self.getClient( cid );
		client.send( fail, sent );
		function sent( err ) {
			self.removeClient( cid );
		}
	}
}

ns.NoMansLand.prototype.setupAccount = function( conf, clientId ) {
	const self = this;
	
	// session
	const aid = conf.clientId;
	const session = self.createSession( aid );
	self.addToSession( session.id, clientId );
	
	// account
	const account = new Account(
		conf,
		session,
		self.dbPool,
		self.roomCtrl
	);
	self.setAccount( account );
}

ns.NoMansLand.prototype.logAccounts = function() {
	const self = this;
	const accIds = Object.keys( self.accounts );
	const logins = accIds.map( getLogin );
	log( 'logged in accounts: ', logins );
	
	function getLogin( id ) {
		const acc = self.getAccount( id );
		return acc.login || acc.id;
	}
}

ns.NoMansLand.prototype.validate = function( bundle, callback ) {
	const self = this;
	if ( 'authid' === bundle.type ) {
		self.validateAuthId( bundle.data, callback );
		return;
	}
	
	callback( 'ERR_AUTH_UNKNOWN', null );
}

ns.NoMansLand.prototype.validateAuthId = function( data, callback ) {
	const self = this;
	const authId = data.tokens.authId;
	authRequest( authId, userBack );
	function userBack( err, user ) {
		if ( err ) {
			callback( err, null );
			return;
		}
		
		if ( !user || !user.Name ) {
			callback( 'ERR_INVALID_AUTHID', null );
			return;
		}
		
		if ( user.Name !== data.login ) {
			callback( 'ERR_INVALID_LOGIN', null );
			return;
		}
		
		getWorkGroups( authId, wgsBack )
		function wgsBack( err, userWgs ) {
			if ( !err )
				
			
			getStreamWorkgroupSetting( authId, streamWgsBack );
			function streamWgsBack( err , streamWgs ) {
				buildAccountConf( user, userWgs, streamWgs );
			}
		}
	}
	
	function buildAccountConf( user, userWgs, streamWgs ) {
		userWgs = userWgs.map( normalize );
		const isAdmin = !!( 'Admin' === user.Level );
		// WG : workgroup
		const userWGNames = getWGList( user.Workgroup );
		const worgs = {
			available : null,
			member    : getUserWGs( userWGNames, userWgs ),
		};
		
		if ( isAdmin )
			worgs.available = userWgs;
		
		if ( streamWgs )
			worgs.stream = streamWgs;
		
		const auth = {
			login      : user.Name,
			admin      : isAdmin,
			workgroups : worgs,
		};
		callback( null, auth );
		
		function normalize( fcwg ) {
			let wg = {
				fId      : '' + fcwg.ID,
				clientId : 'friend_wg_' + fcwg.ID,
				name     : fcwg.Name,
			};
			return wg;
		}
	}
	
	function getWGList( str ) {
		let wgs = [];
		if ( !str || !str.length )
			return wgs;
		
		wgs = str.split( ', ' );
		return wgs;
	}
	
	function getUserWGs( userWGNames, WGs ) {
		let list = WGs.filter( inUserWGNames );
		return list;
		
		function inUserWGNames( wg ) {
			let index = userWGNames.indexOf( wg.name );
			if ( -1 === index )
				return false;
			else
				return true;
		}
	}
	
	function authRequest( authId, reqBack ) {
		var data = {
			module  : 'system',
			command : 'userinfoget',
			authid  : authId,
			/*
			args    : JSON.stringify({
				mode : 'all',
			}),
			*/
		};
		
		var req = {
			path : '/system.library/module/',
			data : data,
			success : success,
			error : error,
		};
		self.fcReq.post( req );
		
		function success( data ) {
			reqBack( null, data );
		}
		
		function error( err ) {
			reqBack( 'ERR_HOST_UNICORN_POOP', err );
		}
	}
	
	function getWorkGroups( authId, reqBack ) {
		const data = {
			module  : 'system',
			command : 'workgroups',
			authid  : authId,
		};
		
		const req = {
			path    : '/system.library/module',
			data    : data,
			success : success,
			error   : error,
		};
		self.fcReq.post( req );
		function success( data ) {
			reqBack( null, data );
		}
		
		function error( err ) {
			log( 'wgs req error', err );
			reqBack( err, null );
		}
	}
	
	function getStreamWorkgroupSetting( authId, reqBack ) {
		const data = {
			module  : 'system',
			command : 'getsystemsetting',
			authid  : authId,
			args    : JSON.stringify({
				type : 'friendchat',
				key  : 'systemsettings',
			}),
		};
		const req = {
			path    : '/system.library/module',
			data    : data,
			success : success,
			error   : error,
		};
		self.fcReq.post( req );
		function success( data ) {
			if ( !data || !data.length ) {
				reqBack( null, null );
				return;
			}
			
			let wgs = data.map( item => {
				let setting = null;
				try {
					setting = JSON.parse( item.Data );
				} catch( e ) {
					log( 'error parsing system setting', item );
					return null;
				}
				
				if ( setting && setting.classroom_teachers )
					return setting.classroom_teachers;
				
				if ( setting && setting.stream_source )
					return setting.stream_source;
				
				return null;
			});
			
			wgs = wgs.filter( item => !!item );
			reqBack( null, wgs );
		}
		
		function error( err ) {
			log( 'getStreamWorkgroupSetting - error', err );
		}
	}
}

ns.NoMansLand.prototype.addClient = function( client ) {
	const self = this;
	if ( !client || !client.id )
		return null;
	
	const cid = client.id;
	self.connections[ cid ] = client;
	self.connIds = Object.keys( self.connections );
	client.on( 'close', closed );
	return cid;
	
	function closed( e ) { self.removeClient( cid ); }
}

ns.NoMansLand.prototype.removeClient = function( cid ) {
	const self = this;
	const client = self.getClient( cid );
	if ( !client ) {
		log( 'removeClient - no client for id', cid );
		return;
	}
	
	// no more events from you, mister
	client.release();
	
	// release session / account
	if ( client.sessionId )
		self.removeFromSession( client.sessionId, client.id, thenTheSocket );
	else
		thenTheSocket(); // remove socket
	
	function thenTheSocket() {
		var client = self.getClient( cid );
		delete self.connections[ cid ];
		self.connIds = Object.keys( self.connections  );
		client.close();
	}
}

ns.NoMansLand.prototype.getClient = function( cid ) {
	const self = this;
	return self.connections[ cid ] || null;
}

ns.NoMansLand.prototype.createSession = function( accountId ) {
	const self = this;
	const sid = uuid.get( 'session' );
	const session = new Session( sid, accountId, onclose );
	self.sessions[ sid ] = session;
	return session;
	
	function onclose() {
		self.sessionClosed( sid );
	}
}

ns.NoMansLand.prototype.getSession = function( sid ) {
	const self = this;
	const session = self.sessions[ sid ];
	if ( !session ) {
		log( 'no session found for', {
			sid      : sid,
			sessions : self.sessions,
		}, 2 );
		return null;
	}
	
	return session;
}

ns.NoMansLand.prototype.addToSession = function( sessionId, clientId ) {
	const self = this;
	const session = self.getSession( sessionId );
	const client = self.getClient( clientId );
	if ( !session || !client )
		return;
	
	session.attach( client );
}

ns.NoMansLand.prototype.restoreSession = function( sessionId, clientId ) {
	const self = this;
	const client = self.getClient( clientId );
	if ( !client )
		return;
	
	const session = self.getSession( sessionId );
	if ( !session )
		restoreFailed( client );
	else
		restoreSuccess( client );
	
	function restoreFailed( client ) {
		const sessFail = {
			type : 'session',
			data : false,
		};
		client.sendCon( sessFail, failSent );
		function failSent() {
			self.removeClient( clientId );
		}
	}
	
	function restoreSuccess( client ) {
		session.attach( client );
		self.sendReady( client.id );
	}
}

ns.NoMansLand.prototype.removeFromSession = function( sessionId, clientId, callback ) {
	const self = this;
	const session = self.getSession( sessionId );
	if ( !session )
		return;
	
	session.detach( clientId, callback );
}

ns.NoMansLand.prototype.sessionClosed = function( sid ) {
	const self = this;
	const session = self.getSession( sid );
	if ( !session )
		return;
	
	delete self.sessions[ sid ];
	const account = self.getAccount( session.accountId );
	if ( !account )
		return;
	
	self.removeAccount( account.id );
	account.close();
}

ns.NoMansLand.prototype.setAccount = function( account ) {
	const self = this;
	const aid = account.id;
	if ( self.accounts[ aid ]) {
		log( 'setAccount - account already set', account );
		return;
	}
	
	self.accounts[ aid ] = account;
	self.logAccounts();
}

ns.NoMansLand.prototype.getAccount = function( accountId ) {
	const self = this;
	const acc = self.accounts[ accountId ];
	if ( !acc ) {
		return null; 
	}
	
	return acc;
}

ns.NoMansLand.prototype.removeAccount = function( aid ) {
	const self = this;
	const account = self.accounts[ aid ];
	delete self.accounts[ aid ];
	
	self.logAccounts();
}


module.exports = ns.NoMansLand;
