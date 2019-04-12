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
const dFace = require( './DFace' );
const uuid = require( './UuidPrefix')();

var ns = {};

ns.NoMansLand = function( dbPool, userCtrl, roomCtrl, fcReq ) {
	const self = this;
	self.dbPool = dbPool;
	self.userCtrl = userCtrl;
	self.roomCtrl = roomCtrl;
	self.fcReq = fcReq;
	
	self.tcpPool = null;
	self.wsPool = null;
	self.connections = {};
	self.sessions = {};
	self.sessionAccountMap = {};
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
	delete self.userCtrl;
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

ns.NoMansLand.prototype.checkClientAuth = async function( auth, cid ) {
	const self = this;
	// invite is special; anon/guest login
	if ( 'anon-invite' === auth.type ) {
		await self.checkInvite( auth.data, cid );
		return;
	}
	
	const user = await self.validate( auth );
	self.setClientAuthenticated( !!user, cid );
	if ( !user ) {
		self.removeClient( cid );
		return;
	}
	
	self.setClientAccountStage( user, cid );
}

ns.NoMansLand.prototype.checkInvite = async function( bundle, cid ) {
	const self = this;
	const roomId = await self.roomCtrl.authorizeGuestInvite( bundle.tokens );
	self.setClientAuthenticated( !!roomId, cid );
	if ( !roomId ) {
		self.removeClient( cid );
		return;
	}
	
	self.loginGuest( bundle.identity, roomId, cid );
}

ns.NoMansLand.prototype.loginGuest = function( identity, roomId, cId ) {
	const self = this;
	const client = self.getClient( cId );
	if ( !client )
		return;
	
	// session
	const accId = uuid.get( 'guest' );
	const session = self.createSession( accId );
	self.addToSession( session.id, cId );
	
	// guest account
	const accConf = {
		clientId : accId,
		name     : identity.name,
		avatar   : identity.avatar,
		isGuest  : true,
	};
	self.userCtrl.addGuest( session, accConf, roomId );
	self.sendAccountReady( cId, accId );
}

ns.NoMansLand.prototype.setClientAuthenticated = function( success, cid, callback ) {
	const self = this;
	const client = self.getClient( cid );
	if ( !client )
		return;
	
	const auth = {
		type : 'authenticate',
		data : !!success,
	};
	client.sendCon( auth, callback );
}

ns.NoMansLand.prototype.setClientAccountStage = function( friendData, cid ) {
	const self = this;
	const client = self.getClient( cid );
	if ( !client ) {
		self.removeClient( cid );
		return;
	}
	
	client.friendData = friendData;
	client.on( 'msg', handleEvent );
	
	// send account challenge
	const accE = {
		type : 'account',
		data : null,
	};
	client.send( accE );
	
	function handleEvent( e ) { self.handleAccountEvent( e, cid ); }
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
	
	client.friendData = null;
	client.release( 'msg' );
}

ns.NoMansLand.prototype.createAccount = function( bundle, cid ) {
	const self = this;
	log( 'createAccount - FIX THIS', bundle );
	return;
	
	const client = self.getClient( cid );
	if ( !bundle.login
		|| !bundle.login.length
		|| !bundle.name
		|| !bundle.name.length
	) {
		createFailed( 'ERR_ACCOUNT_CREATE_MISSING', bundle );
		return;
	}
	
	self.accDb.getByFUsername( bundle.login )
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
		self.accDb.set( bundle.userId, bundle.login, bundle.name )
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

ns.NoMansLand.prototype.clientLogin = async function( clientAuth, cid ) {
	const self = this;
	if ( !clientAuth ) {
		loginFailed( 'ERR_NO_LOGIN_DATA', clientAuth );
		return;
	}
	
	const client = self.getClient( cid );
	const fData = client.friendData;
	let valid = validateClient( clientAuth, fData );
	if ( !valid ) {
		loginFailed( 'ERR_INVALID_AUTH', clientAuth );
		return null;
	}
	
	let dbAcc = await getAccount( fData );
	if ( !dbAcc )
		dbAcc = await createAccount( fData, clientAuth );
	
	if ( !dbAcc ) {
		log( 'clientLogin - failed to load or create account', clientAuth );
		return null;
	}
	
	let accId = dbAcc.clientId;
	let identity = client.friendData;
	
	identity.clientId = accId;
	identity.isGuest = false;
	self.unsetClientAccountStage( cid );
	const session = self.getSessionForAccount( accId );
	if ( session ) // already logged in
		self.addToSession( accId, cid );
	else
		await self.setupSession( identity, cid );
	
	self.sendAccountReady( cid, accId );
	
	function loginFailed( err, data ) {
		log( 'loginFailed', err.stack || err );
		const fail = {
			type : 'error',
			data : {
				error : err,
				data : data,
			},
		};
		let client = self.getClient( cid );
		client.send( fail, sent );
		function sent( err ) {
			self.removeClient( cid );
		}
	}
	
	function validateClient( cData, fData ) {
		const fUserId = cData.fUserId;
		const fUsername = cData.fUsername;
		if ( !fUserId && !fUsername )
			return false;
		
		let valid = false;
		if ( fUserId )
			valid = fUserId === fData.fUserId;
		else
			valid = fUsername === fData.fUsername;
		
		return valid;
	}
	
	async function getAccount( fData ) {
		let fUserId = fData.fUserId;
		let fUsername = fData.fUsername;
		let dbAcc = null;
		if ( fUserId )
			dbAcc = await self.accDb.getByFUserId( fUserId );

		if ( !dbAcc ) {
			dbAcc = await self.accDb.getByFUsername( fUsername );
			if ( !dbAcc )
				return null;
			
			if ( fUserId )
				await self.accDb.setFUserId( dbAcc.clientId, fUserId );
		}
		
		return dbAcc;
	}
	
	async function createAccount( fData, cData ) {
		log( 'createAccount', {
			fData : fData,
			cData : cData,
		}, 3 );
		const fId = fData.fUserId || null;
		const fName = fData.fUsername;
		const name = fData.name;
		await self.accDb.set( fId, fName, name );
		if ( fId )
			await self.accDb.getByFUserId( fId );
		else
			await self.accDb.getByFUsername( fName );
		
		return await getAccount( fData );
	}
	
	function sendCreate( cId ) {
		var create = {
			type : 'account',
			data : {
				type : 'create',
				data : null,
			},
		};
		let client = self.getClient( cId );
		client.send( create );
	}
}

ns.NoMansLand.prototype.setupSession = async function( conf, clientId ) {
	const self = this;
	// session
	const accId = conf.clientId;
	const session = self.createSession( accId );
	self.addToSession( session.id, clientId );
	await self.userCtrl.addAccount( session, conf );
	return true;
}

ns.NoMansLand.prototype.validate = async function( bundle ) {
	const self = this;
	if ( 'authid' === bundle.type )
		return self.validateAuthId( bundle.data );
	
	throw new Error( 'ERR_AUTH_UNKNOWN' );
}

ns.NoMansLand.prototype.validateAuthId = async function( data ) {
	const self = this;
	const authId = data.tokens.authId;
	let fUser = null;
	try {
		fUser = await authRequest( authId );
	} catch( err ) {
		log( 'validateAuthId - err', err );
		return null;
	}
	
	if ( !fUser )
		return null;
	
	let user = self.transformFUser( fUser );
	if ( !user ) {
		log( 'ERR_INVALID_AUTHID', data );
		return null;
	}
	
	if ( user.fUsername !== data.login ) {
		log( 'ERR_INVALID_LOGIN', data );
		return null;
	}
	
	user = await self.addWorkgroups( user, authId );
	return user;
	
	async function authRequest( authId ) {
		return new Promise(( resolve, reject ) => {
			var data = {
				module  : 'system',
				command : 'userinfoget',
				authid  : authId,
			};
			
			var req = {
				path    : '/system.library/module/',
				data    : data,
				success : success,
				error   : error,
			};
			self.fcReq.post( req );
			
			function success( data ) {
				resolve( data );
			}
			
			function error( err ) {
				reject( 'ERR_HOST_UNICORN_POOP' );
			}
		});
	}
}

ns.NoMansLand.prototype.transformFUser = function( fUser ) {
	const self = this;
	const user = {
		fUserId    : fUser.UniqueID || null,
		fUsername  : fUser.Name,
		name       : fUser.FullName,
		email      : fUser.Email || '',
		avatar     : fUser.Image || '',
		isAdmin    : !!( 'Admin' === fUser.Level ),
		workgroups : getWGList( fUser.Workgroup ),
	};
	
	if ( !user.fUsername )
		return null;
	
	return user;
	
	function getWGList( wgStr ) {
		let wgs = [];
		if ( !wgStr || !wgStr.length )
			return wgs;
		
		wgs = wgStr.split( ',' ).filter( item => {
			if ( !item || !item.length || !item.trim )
				return false;
			return true;
		});
		
		wgs = wgs.map( item => item.trim());
		return wgs;
	}
}

ns.NoMansLand.prototype.addWorkgroups = async function( user, authId ) {
	const self = this;
	let allWgs = [];
	let streamWgs = null;
	let pSettings = null;
	try {
		allWgs = await getWorkGroups( authId );
	} catch( err ) {
		log( 'addWorkgroups - getWorkGroups err', err );
		user.workgroups = {};
		return user;
	}
	
	try {
		streamWgs = await getStreamWorkgroupSetting( authId );
	} catch( err ) {
		log( 'addWorkgroups - getStreamWorkgroupSetting err', err );
	}
	
	try {
		pSettings = await getPresenceSettings( authId );
	} catch( err ) {
		log( 'addWorkgroups - getPresenceSettings err', err );
	}
	
	allWgs = allWgs.map( normalize );
	const worgs = {
		available : allWgs,
		member    : getUserWGs( user.workgroups, allWgs ),
	};
	
	if ( streamWgs )
		worgs.stream = streamWgs;
	
	if ( pSettings ) {
		worgs.supergroups = pSettings.supergroups;
		worgs.streamgroups = pSettings.streamgroups;
	}
	
	user.workgroups = worgs;
	return user;
	
	function normalize( fcwg ) {
		let fPId = getParentId( fcwg.ParentID );
		let wg = {
			fId       : '' + fcwg.ID,
			fParentId : fPId,
			name      : fcwg.Name,
		};
		return wg;
		
		function getParentId( fPId ) {
			if ( !fPId )
				return null;
			
			if ( '0' == fPId )
				return null;
			
			return '' + fPId;
		}
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
	
	function getWorkGroups( authId ) {
		return new Promise(( resolve, reject ) => {
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
				resolve( data );
			}
			
			function error( err ) {
				log( 'wgs req error', err );
				reject( err );
			}
		});
	}
	
	function getStreamWorkgroupSetting( authId ) {
		return new Promise(( resolve, reject ) => {
			const data = {
				module  : 'system',
				command : 'getsystemsetting',
				authid  : authId,
				args    : JSON.stringify({
					type : 'presence',
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
					reject( 'ERR_NO_DATA' );
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
				resolve( wgs );
			}
			
			function error( err ) {
				log( 'getStreamWorkgroupSetting - error', err );
				reject( err );
			}
		});
	}
	
	function getPresenceSettings( authId ) {
		return new Promise(( resolve, reject ) => {
			const data = {
				module  : 'system',
				command : 'getsystemsetting',
				authid  : authId,
				args    : JSON.stringify({
					type : 'presence',
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
					reject( 'ERR_NO_DATA' );
					return;
				}
				
				const settings = {
					supergroups  : [],
					streamgroups : [],
				};
				let wgs = data.map( item => {
					let setting = null;
					try {
						setting = JSON.parse( item.Data );
					} catch( e ) {
						log( 'error parsing system setting', item );
						return null;
					}
					
					if ( !setting )
						return null;
					
					if ( setting.supergroups )
						settings.supergroups = setting.supergroups.split( ',' );
					
					if ( setting.streamgroups )
						settings.streamgroups = setting.streamgroups.split( ',' );
				});
				
				resolve( settings );
			}
			
			function error( err ) {
				log( 'getPresenceSettings - error', err );
				reject( err );
			}
			
		});
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

ns.NoMansLand.prototype.createSession = function( accId ) {
	const self = this;
	const sId = uuid.get( 'session' );
	const session = new Session( sId, accId, onclose );
	self.sessions[ sId ] = session;
	self.sessionAccountMap[ accId ] = sId;
	return session;
	
	function onclose() {
		self.sessionClosed( sId );
	}
}

ns.NoMansLand.prototype.getSession = function( sessionId ) {
	const self = this;
	const session = self.sessions[ sessionId ];
	if ( !session ) {
		return null;
	}
	
	return session;
}

ns.NoMansLand.prototype.getSessionForAccount = function( accountId ) {
	const self = this;
	let sessionId = self.sessionAccountMap[ accountId ];
	return self.getSession( sessionId );
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
	if ( !session ) {
		log( 'removeFromSession - no session for', sessionId );
		return;
	}
	
	session.detach( clientId, callback );
}

ns.NoMansLand.prototype.sessionClosed = function( sessionId ) {
	const self = this;
	const session = self.sessions[ sessionId ];
	if ( !session )
		return;
	
	const accId = session.accountId;
	delete self.sessions[ sessionId ];
	delete self.sessionAccountMap[ accId ];
	self.userCtrl.remove( accId );
}

ns.NoMansLand.prototype.sendReady = function( cid ) {
	const self = this;
	const client = self.getClient( cid );
	if ( !client )
		return;
	
	const ready = {
		type : 'ready',
		data : null,
	}
	client.send( ready );
}

ns.NoMansLand.prototype.sendAccountReady = function( clientId, accountId ) {
	const self = this;
	const client = self.getClient( clientId );
	if ( !client )
		return;
	
	const accReady = {
		type : 'account',
		data : {
			type : 'login',
			data : accountId,
		},
	};
	client.send( accReady );
}

module.exports = ns.NoMansLand;
