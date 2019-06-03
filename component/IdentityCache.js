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
	
	if ( self.accDB )
		self.accDB.close();
	
	delete self.accDB;
	delete self.lastAccess;
	delete self.IDs;
}

ns.IDC.prototype.set = async function( fcId ) {
	const self = this;
}


ns.IDC.prototype.get = async function( id ) {
	const self = this;
	if ( !id ) {
		try {
			throw new Error( 'ERR_NO_ID' );
		} catch( err ) {
			log( 'IDC.get - missing id', err.stack || err );
		}
	}
	let identity = self.getSync( id );
	if ( identity )
		return identity;
	
	identity = await self.load( id );
	return identity;
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

ns.IDC.prototype.update = async function( identity ) {
	const self = this;
	const cId = identity.clientId;
	const cache = await self.get( cId );
	cache.fLogin = identity.fLogin;
	cache.isAdmin = !!identity.isAdmin;
	cache.isGuest = !!identity.isGuest;
	const nameChange = await self.checkName( identity, cache );
	const avaChange = await self.checkAvatar( identity, nameChange );
	//self.checkEmail( identity, cache );
	
	if ( nameChange )
		self.sendUpdate( cId, 'name' );
	
	if ( avaChange )
		self.sendUpdate( cId, 'avatar' );
	
	return cache;
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
	
	// trim every 24 hours
	self.trim = setInterval( trims, self.TIMEOUT );
	function trims() {
		self.trimIds();
	}
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
	if ( !identity )
		return null;
	
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
	self.touch( cId );
}

ns.IDC.prototype.touch = function( id ) {
	const self = this;
	self.lastAccess[ id ] = Date.now();
}

ns.IDC.prototype.checkName = async function( id, c ) {
	const self = this;
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
	log( 'checkAvatar', {
		id   : id,
		name : nameChange,
	}, 3 );
	const uId = id.clientId;
	let current = id.avatar;
	if ( nameChange && ( null == current )) {
		log( 'checkAvatar - namechange' );
		const dbId = await self.accDB.getById( uId );
		if ( dbId && !dbId.avatar ) {
			await self.setPixelAvatar();
			return true;
		} else
			return false;
	}
	
	if ( null == current )
		return false;
	
	let change = false;
	if ( false === current ) 
		change = await self.resetAvatar( uId );
	else
		change = await self.setAvatar( uId, current );
	
	return change;
}

ns.IDC.prototype.setAvatar = async function( userId, avatar ) {
	const self = this;
	log( 'setAvatar', userId );
	const dbId = await self.accDB.getById( userId );
	if ( !dbId )
		return false;
	
	const tiny = await tinyAvatar.rescale( avatar );
	log( 'setAvatar - tiny', {
		tiny  : tiny ? tiny.slice( -10 ) : '',
		cache : dbId.avatar ? dbId.avatar.slice( -10 ) : '',
	}, 3 );
	if ( dbId.avatar === tiny )
		return true;
	
	log( 'setting tiny', tiny.slice( -10 ));
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
	
	log( 'resetAvatar', {
		uid  : userId,
		dbId : dbId,
	});
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
	 	log( 'setPixelAvatar - something interesting happend while trying to\
	 		to create a pixel avatar', {
	 			cId    : clientId,
	 			id     : cacheId,
	 			pixels : pixels,
	 		}, 3 );
		return false;
	 }
	
	if ( pixels === cacheId.avatar )
		return false;
	
	cacheId.avatar = pixels;
	return true;
}

ns.IDC.prototype.checkEmail = async function( id, c ) {
	const self = this;
	log( 'checkEmail - NYI', id );
	return true;
}

ns.IDC.prototype.sendUpdate = function( userId, type ) {
	const self = this;
	const id = self.getSync( userId );
	const update = {
		type : type,
		data : id,
	};
	self.emitUpdate( update );
}

ns.IDC.prototype.emitUpdate = function( event ) {
	const self = this;
	self.emit( 'update', event );
}

module.exports = ns.IDC;
