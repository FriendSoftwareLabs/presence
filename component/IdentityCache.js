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

const log = require( './Log' )( 'IDC' );
const uuid = require( './UuidPrefix' )( 'msg' );
const Emitter = require( './Events' ).Emitter;
const tinyAvatar = require( './TinyAvatar' );
const dFace = require( './DFace' );

const util = require( 'util' );

var ns = {};

ns.IDC = function( dbPool ) {
	const self = this;
	log( 'hi!' );
	
	Emitter.call( self );
	
	self.IDs = {};
	self.FIDs = {};
	self.lastAccess = {};
	self.TIMEOUT = 1000 * 60 * 60 * 36;
	self.accDB = null;
	self.alphaNumList = [];
	
	self.init( dbPool );
}

util.inherits( ns.IDC, Emitter );

// Public

ns.IDC.prototype.close = function() {
	const self = this;
	if ( null != self.trim ) {
		clearInterval( self.trim );
		self.trim = null;
	}
	
	if ( null != self.updateANListTimeout )
		clearTimeout( self.updateANListTimeout )
	
	if ( self.accDB )
		self.accDB.close();
	
	delete self.accDB;
	delete self.lastAccess;
	delete self.IDs;
}

ns.IDC.prototype.set = async function( fUser ) {
	const self = this;
	const f = fUser;
	if ( !f.fUserId || !f.fUsername ) {
		log( 'set - user data missing, dropping', fUser );
		return;
	}
	
	const dbId = await self.accDB.set(
		f.fUserId,
		f.fUsername,
		f.fLastUpdate,
		f.fIsDisabled,
		f.name
	);
	
	if ( !dbId ) {
		log( 'set - the id was not written to db for, probably, reasons', fUser );
		return;
	}
	
	const identity = await self.setDBID( dbId );
	const cId = identity.clientId;
	if ( null != fUser.avatar )
		await self.setAvatar( cId, fUser.avatar );
	
	self.emit( 'add', identity );
	self.updateAlphaNumList();
	
	return identity;
}

ns.IDC.prototype.get = async function( clientId ) {
	const self = this;
	if ( !clientId ) {
		try {
			throw new Error( 'ERR_NO_ID' );
		} catch( err ) {
			log( 'IDC.get - missing id', err.stack || err );
		}
	}
	let identity = self.getSync( clientId );
	if ( identity )
		return identity;
	
	identity = await self.load( clientId );
	return identity || null;
}

ns.IDC.prototype.getList = async function( idList ) {
	const self = this;
	let identities = await Promise.all( idList.map( await get ));
	if ( !identities || !identities.length )
		return [];
	
	return identities.filter( id => id != null );
	
	async function get( id ) {
		let identity = self.getSync( id );
		if ( null != identity )
			return identity;
		
		identity = await self.load( id );
		if ( !identity )
			return null;
		
		return identity;
	}
}

ns.IDC.prototype.getAlphaNumList = function() {
	const self = this;
	return self.alphaNumList;
}

ns.IDC.prototype.getMap = async function( idList ) {
	const self = this;
	const ids = {};
	const leftovers = idList.filter( trySync );
	await Promise.all( leftovers.map( await load ));
	return ids;
	
	function trySync( cId ) {
		let id = self.getSync( cId );
		if ( !id )
			return true;
		
		ids[ cId ] = id;
		return false;
	}
	
	async function load( cId ) {
		let id = await self.load( cId );
		if ( !id )
			return false;
		
		ids[ cId ] = id;
		return true;
	}
}

ns.IDC.prototype.getByFUserId = async function( fId ) {
	const self = this;
	if ( !fId || 'string' !== typeof( fId ))
		return null;
	
	let id = self.FIDs[ fId ];
	if ( id )
		return id;
	
	id = await self.loadFID( fId );
	return id || null;
}

ns.IDC.prototype.getByFUsername = async function( fUsername ) {
	const self = this;
	if ( !fUsername || 'string' !== typeof( fUsername ))
		return null;
	
	const id = await self.accDB.getByFUsername( fUsername );
	return id || null;
}

ns.IDC.prototype.update = async function( identity ) {
	const self = this;
	let cId = identity.clientId;
	let cache = null;
	if ( cId ) {
		cache = await self.get( cId );
	} else {
		cache = await load( identity );
		if ( cache ) {
			identity.clientId = cache.clientId;
			cId = cache.clientId;
		}
	}
	
	if ( !cache ) {
		cache = await self.set( identity );
		return cache;
	}
	
	if ( null != identity.fLogin )
		cache.fLogin = identity.fLogin;
	if ( null != identity.isAdmin )
		cache.isAdmin = !!identity.isAdmin;
	if ( null != identity.isGuest )
		cache.isGuest = !!identity.isGuest;
	
	const nameChange = await self.checkName( identity, cache );
	const avaChange = await self.checkAvatar( identity, nameChange );
	const disableChange = await self.checkDisabled( identity, cache );
	//self.checkEmail( identity, cache );
	
	if ( null != identity.fLastUpdate )
		await self.accDB.updateFLastUpdate( cId, identity.fLastUpdate );
	
	if ( nameChange ) {
		self.updateAlphaNumList();
		self.sendUpdate( cId, 'name' );
	}
	
	if ( avaChange )
		self.sendUpdate( cId, 'avatar' );
	
	if ( disableChange ) {
		self.updateAlphaNumList();
		self.sendUpdate( cId, 'fIsDisabled' );
	}
	
	return cache;
	
	async function load( id ) {
		const fId = identity.fUserId;
		const fName = identity.fUsername;
		let cache = null;
		if ( fId )
			cache = await self.getByFUserId( fId );
		
		if ( cache )
			return cache;
		
		if ( !fName )
			return null;
		
		cache = await self.getByFUsername( fName );
		if ( cache && fId ) {
			await self.accDB.setFUserId( cache.clientId, fId );
		}
		
		return cache;
	}
}

ns.IDC.prototype.updateAvatar = async function( userId, avatar ) {
	const self = this;
	if ( null == avatar )
		return;
	
	if ( false === avatar ) {
		await self.resetAvatar( userId );
	} else
		await self.setAvatar( userId, avatar );
	
	self.sendUpdate( userId, 'avatar' );
}

ns.IDC.prototype.setOnline = function( clientId, isOnline ) {
	const self = this;
	const id = self.IDs[ clientId ];
	if ( !id )
		return;
	
	id.isOnline = isOnline;
	self.sendUpdate( clientId, 'isOnline' );
}

ns.IDC.prototype.checkOnline = function( clientId ) {
	const self = this;
	const id = self.IDs[ clientId ];
	if ( !id )
		return false;
	
	return id.isOnline;
}

ns.IDC.prototype.addGuest = function( id ) {
	const self = this;
	id.avatar = null;
	id.isGuest = true;
	self.add( id );
	return id;
}

// Private

ns.IDC.prototype.init = async function( dbPool ) {
	const self = this;
	self.accDB = new dFace.AccountDB( dbPool );
	self.pixels = await tinyAvatar.generateGuest( 'roundel' );
	await self.updateAlphaNumList();
	
	// trim every 24 hours
	/*
	self.trim = setInterval( trims, self.TIMEOUT );
	function trims() {
		self.trimIds();
	}
	*/
}

ns.IDC.prototype.trimIds = function() {
	const self = this;
	let old = Date.now() - self.TIMEOUT;
	let ids = Object.keys( self.IDs );
	ids.forEach( id => {
		let accessTime = self.lastAccess[ id ];
		if ( accessTime > old )
			return;
		
		let fId = self.IDs[ id ].fUserId;
		if ( fId )
			delete self.FIDs[ fId ];
		
		delete self.IDs[ id ];
		delete self.lastAccess[ id ];
	});
}

ns.IDC.prototype.getSync = function( cId ) {
	const self = this;
	let identity = self.IDs[ cId ];
	if ( !identity ) {
		log( 'getSync - no id', cId );
		return null;
	}
	
	self.touch( cId );
	return identity;
}

ns.IDC.prototype.load = async function( cId ) {
	const self = this;
	let dbId = null;
	try {
		dbId = await self.accDB.getById( cId );
	} catch( e ) {
		log( 'load - db error', e );
	}
	
	if ( !dbId )
		return null;
	
	let identity = await self.setDBID( dbId );
	return identity;
}

ns.IDC.prototype.loadFID = async function( fId ) {
	const self = this;
	let dbId = null;
	try {
		dbId = await self.accDB.getByFUserId( fId );
	} catch ( e ) {
		log( 'loadFID - db fail', e );
		return null;
	}
	
	if ( !dbId )
		return null;
	
	let id = await self.setDBID( dbId );
	return id;
}

ns.IDC.prototype.setDBID = async function( dbId ) {
	const self = this;
	let cId = dbId.clientId;
	let identity = {
		clientId    : cId,
		fUserId     : dbId.fUserId,
		fUsername   : dbId.fUsername,
		fLastUpdate : dbId.fLastUpdate,
		fIsDisabled : !!dbId.fIsDisabled || undefined,
		name        : dbId.name,
		avatar      : dbId.avatar,
		isAdmin     : null,
		isOnline    : false,
	};
	
	self.add( identity );
	if ( !identity.avatar )
		await self.setPixelAvatar( cId );
	
	return identity;
}

ns.IDC.prototype.add = function( id ) {
	const self = this;
	const cId = id.clientId;
	const fId = id.fUserId;
	if ( fId )
		self.FIDs[ fId ] = id;
	
	self.IDs[ cId ] = id;
	const stamp = self.touch( cId );
	id.lastUpdate = stamp;
}

ns.IDC.prototype.touch = function( userId ) {
	const self = this;
	const stamp = Date.now();
	self.lastAccess[ userId ] = stamp;
	return stamp;
}

ns.IDC.prototype.checkName = async function( id, c ) {
	const self = this;
	if ( null == id.name )
		return false;
	
	if ( id.name === c.name )
		return false;
	
	const cId = c.clientId;
	const name = id.name;
	await self.accDB.updateName( cId, name );
	c.name = name;
	
	return true;
}

ns.IDC.prototype.checkAvatar = async function( id, nameChange ) {
	const self = this;
	const cId = id.clientId;
	let current = id.avatar;
	if ( nameChange && ( null == current )) {
		const dbId = await self.accDB.getById( cId );
		if ( dbId && !dbId.avatar ) {
			await self.setPixelAvatar( cId );
			return true;
		} else
			return false;
	}
	
	if ( null == current )
		return false;
	
	let change = false;
	if ( false === current ) 
		change = await self.resetAvatar( cId );
	else
		change = await self.setAvatar( cId, current );
	
	return change;
}

ns.IDC.prototype.setAvatar = async function( userId, avatar ) {
	const self = this;
	const dbId = await self.accDB.getById( userId );
	if ( !dbId )
		return false;
	
	const tiny = await tinyAvatar.rescale( avatar );
	if ( !tiny )
		return false;
	
	if ( dbId.avatar === tiny )
		return true;
	
	await self.accDB.updateAvatar( userId, tiny );
	const cacheId = await self.get( userId );
	cacheId.avatar = tiny;
	return true;
}

ns.IDC.prototype.resetAvatar = async function( userId ) {
	const self = this;
	const dbId = await self.accDB.getById( userId );
	if ( !dbId )
		return false;
	
	if ( !dbId.avatar )
		return false;
	
	await self.accDB.updateAvatar( userId, null );
	return await self.setPixelAvatar( userId );
}

ns.IDC.prototype.setPixelAvatar = async function( clientId ) {
	const self = this;
	const cacheId = await self.get( clientId );
	let pixels = await tinyAvatar.generate( cacheId.name, 'roundel' );
	 if ( !pixels ) {
		return false;
	 }
	
	if ( pixels === cacheId.avatar )
		return false;
	
	cacheId.avatar = pixels;
	return true;
}

ns.IDC.prototype.updateAlphaNumList = async function() {
	const self = this;
	if ( null != self.updateANListTimeout ) {
		self.doAnotherANLUpdate = true;
		return;
	}
	
	self.doAnotherANLUpdate = false;
	self.updateANListTimeout = setTimeout( allowReUpdate,  1000 * 10 );
	self.alphaNumList = await self.accDB.getAlphaNumList();
	self.emit( 'invalidate-alphanum-cache', Date.now());
	
	function allowReUpdate() {
		self.updateANListTimeout = null;
		if ( self.doAnotherANLUpdate )
			self.updateAlphaNumList();
	}
}

ns.IDC.prototype.checkEmail = async function( id, c ) {
	const self = this;
	log( 'checkEmail - NYI', id );
	return true;
}

ns.IDC.prototype.checkDisabled = async function( id, c ) {
	const self = this;
	if ( null == id.fIsDisabled )
		return false;
	
	if ( !!id.fIsDisabled == !!c.fIsDisabled )
		return false;
	
	let isDisabled = !!id.fIsDisabled;
	await self.accDB.updateFIsDisabled( c.clientId, isDisabled );
	c.fIsDisabled = isDisabled;
	return true;
}

ns.IDC.prototype.sendUpdate = function( userId, type ) {
	const self = this;
	const id = self.getSync( userId );
	id.lastUpdate = Date.now();
	const update = {
		key        : type,
		value      : id[ type ],
		clientId   : userId,
		lastUpdate : id.lastUpdate,
	};
	self.emitUpdate( update );
}

ns.IDC.prototype.emitUpdate = function( event ) {
	const self = this;
	self.emit( 'update', event );
}

module.exports = ns.IDC;
