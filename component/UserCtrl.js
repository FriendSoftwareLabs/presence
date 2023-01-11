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

const log = require( './Log' )( 'UserCtrl' );
const events = require( './Events' );
const dFace = require( './DFace' );
const Account = require( './Account' );
const Guest = require( './GuestAccount' );
const FService = require( '../api/FService' );

const ns = {};
ns.UserCtrl = function(
	dbPool,
	idCache,
	worgs,
	roomCtrl
) {
	const self = this;
	self.dbPool = dbPool;
	self.idc = idCache;
	self.worgs = worgs;
	self.roomCtrl = roomCtrl;
	self.db = null;
	
	self.accounts = {};
	self.accIds = [];
	self.guests = {};
	self.guestIds = [];
	
	self.fUserUpdateing = {};
	
	self.init( dbPool );
}

// Public

ns.UserCtrl.prototype.refresh = async function( fUserList ) {
	const self = this;
	if ( !fUserList || !fUserList.length )
		return false;
	
	let checks = fUserList.map( needsUpdate );
	checks = await Promise.all( checks );
	let updateUsers = checks.filter( fU => !!fU );
	if ( !updateUsers.length )
		return true;
	
	const updates = updateUsers.map( fetchAndUpdate );
	await Promise.all( updates );
	
	async function needsUpdate( fU ) {
		const fId = fU.userid;
		if ( !fId || !fId.length )
			return false;
		
		const dbUser = await self.idc.getByFUserId( fId );
		if ( !dbUser )
			return fU;
		
		if ( null == fU.lastupdate )
			return false;
		
		if ( dbUser.fLastUpdate < fU.lastupdate )
			return fU;
		
		return false;
	}
	
	async function fetchAndUpdate( fU ) {
		const fId = fU.userid;
		let fUser = null;
		try {
			fUser = await self.service.getUser( fId );
		} catch( ex ) {
			log( 'refresh - fetch ex', ex );
			return null;
		}
		
		await self.update( fUser );
	}
}

ns.UserCtrl.prototype.addAccount = async function( session, conf ) {
	const self = this;
	const accId = conf.clientId;
	if ( self.accounts[ accId ])
		return;
	
	const worgs = conf.workgroups;
	delete conf.workgroups;
	
	conf = await self.idc.update( conf );
	self.worgs.addUser( accId, worgs );
	
	const account = await new Account(
		session,
		accId,
		self.dbPool,
		self.idc,
		self.roomCtrl,
		self.worgs,
	);
	
	self.accounts[ accId ] = account;
	self.accIds.push( accId );
	
	self.idc.setOnline( accId, true );
}

ns.UserCtrl.prototype.addGuest = async function( session, conf, roomId ) {
	const self = this;
	conf = self.idc.addGuest( conf );
	const accId = conf.clientId;
	const guest = await new Guest(
		session,
		accId,
		roomId,
		self.idc,
		self.roomCtrl,
		self.worgs
	);
	
	if ( !guest )
		return;
	
	self.accounts[ accId ] = guest;
	self.accIds.push( accId );
	self.idc.setOnline( accId, true );
}

ns.UserCtrl.prototype.remove = function( accountId ) {
	const self = this;
	const acc = self.accounts[ accountId ];
	if ( !acc )
		return;
	
	delete self.accounts[ accountId ];
	self.accIds = Object.keys( self.accounts );
	acc.close();
	
	self.idc.setOnline( accountId, false );
}

ns.UserCtrl.prototype.update = async function( fUser ) {
	const self = this;
	if ( !fUser.userid ) {
		log( 'update - invalid friend user', fUser );
		return false;
	}
	
	const id = self.normalizeFUser( fUser );
	if ( !id )
		return false;
	
	const identity = await self.idc.update( id );
	if ( !identity )
		return false;
	
	self.updateUserWorgs( id );
	
	return true;
}

ns.UserCtrl.prototype.close = function() {
	const self = this;
	if ( self.serviceConn )
		self.serviceConn.close();
	
	delete self.serviceConn;
	delete self.dbPool;
	delete self.worgs;
	delete self.roomCtrl;
}

// Private

ns.UserCtrl.prototype.init = function() {
	const self = this;
	log( ':3' );
	self.service = new FService();
	self.serviceConn = new events.EventNode( 'user', self.service, serviceSink );
	self.serviceConn.on( 'create', e => self.handleFUserCreate( e ));
	self.serviceConn.on( 'update', e => self.handleFUserUpdate( e ));
	self.serviceConn.on( 'relation-add', e => { 
		try {
			return self.createUserRelation( e );
		} catch( ex ) {
			log( 'createUserRelation ex', ex );
		}
	});
	
	function serviceSink( ...args ) {
		log( 'serviceSink - user', args, 3 );
	}
	
	self.idc.on( 'add', e => self.handleIdAdd( e ));
	self.idc.on( 'update', e => self.handleIdUpdate( e ));
	self.idc.on( 'invalidate-alphanum-cache', e => self.handleInvalidateANCache( e ));
	
	self.worgs.on( 'users-added', ( worgId, accIds ) =>
		self.handleWorgUsersAdded( worgId, accIds ))
	self.worgs.on( 'regenerate', ( regen, add, rem ) => 
		self.handleWorgRegenerate( regen, add, rem ))
	
}

ns.UserCtrl.prototype.handleFUserCreate = async function( event ) {
	const self = this;
	if ( null == event )
		return;
	if ( null != event.originUserId )
		return;
	
	const fUId = event.userid;
	if ( self.fUserUpdateing[ fUId ])
		return;
	
	self.fUserUpdateing[ fUId ] = true;
	let fUser = await self.service.getUser( fUId );
	fUser = self.normalizeFUser( fUser );
	const id = await self.idc.set( fUser );
	if ( null == id )
		return;
	
	self.updateUserWorgs( id );
	
	delete self.fUserUpdateing[ fUId ];
}

ns.UserCtrl.prototype.handleFUserUpdate = async function( fUpdate ) {
	const self = this;
	if ( null == fUpdate )
		return;
	if ( null != fUpdate.originUserId )
		return;
	
	const fUId = fUpdate.userid;
	if ( self.fUserUpdateing[ fUId ])
		return;
	
	self.fUserUpdateing[ fUId ] = true;
	const fUser = await self.service.getUser( fUId );
	await self.update( fUser );
	
	delete self.fUserUpdateing[ fUId ];
	
	
	/*
	const id = await self.idc.getByFUserId( fUId );
	if ( !id ) {
		update( fUId );
		return;
	}
	
	
	if ( fUpdate.groups ) {
		const groups = fUpdate.groups
			.map( fId => self.worgs.getFIdToCId( fId ))
			.filter( cId => !!cId );
		
		//self.worgs.updateUserWorgs( id.clientId, groups );
		fUpdate.groups = groups;
	}
	
	
	update( fUId );
	
	async function update( fUId ) {
		const fUser = await self.service.getUser( fUId );
		self.update( fUser );
	}
	*/
}

ns.UserCtrl.prototype.createUserRelation = async function( req ) {
	const self = this;
	if ( null == req )
		return null;
	if ( null != req.originUserId )
		return null;
	
	if ( null == req.sourceId ) {
		log( 'createUserRelation - no sourceId', req );
		return [];
	}
	
	const sId = req.sourceId;
	const contacts = req.contactIds;
	if (( null == contacts ) || !contacts.length ) {
		log( 'createUserRelation - no contactIds', req );
		return [];
	}
	
	const roomDb = new dFace.RoomDB( self.dbPool );
	const waiters = contacts.map( cId => addPair( sId, cId ));
	let related = await Promise.all( waiters );
	related = related.filter( cId => !!cId );
	roomDb.close();
	
	addContacts( sId, related );
	
	return related;
	
	async function addPair( fUId, fCId ) {
		const user = await self.idc.getByFUserId( fUId );
		const contact = await self.idc.getByFUserId( fCId );
		if ( !user || !contact )
			return null;
		
		const uId = user.clientId;
		const cId = contact.clientId;
		let relation = null;
		try {
			relation = await roomDb.getRelation( uId, cId );
		} catch( ex ) {
			log( 'createUserRelation, addPair - readRelation failed', ex );
		}
		
		if ( null != relation )
			return fCId;
		
		try {
			relation = await roomDb.setRelation( uId, cId );
		} catch( ex ) {
			log( 'createUserRelation, addPair - setRelation failed', ex );
			return null;
		}
		
		if ( null == relation )
			return null;
		
		return fCId;
	}
	
	async function addContacts( fAccId, fresh ) {
		if ( !fresh.length )
			return;
		
		const user = await self.idc.getByFUserId( fAccId );
		const accId = user.clientId;
		const acc = self.accounts[ accId ];
		
		const waiters = fresh.map( fCId => self.idc.getByFUserId( fCId ));
		const ids = await Promise.all( waiters );
		const cIds = ids.map( id => id.clientId );
		
		cIds.forEach( cId => {
			if ( null != acc )
				acc.addRelation( cId );
			
			const contact = self.accounts[ cId ];
			if ( null != contact )
				contact.addRelation( accId );
		});
	}
}

ns.UserCtrl.prototype.handleWorgUsersAdded = async function( worgId, addedAccIds ) {
	const self = this;
	if ( !addedAccIds || !addedAccIds.length ) {
		log( 'handleWorgUsersAdded - not really', addedAccIds );
		return;
	}
	
	log( 'handleWorgUsersAdded', [ worgId, addedAccIds ])
	const addedOnline = addedAccIds.filter( cId => self.idc.checkOnline( cId ));
	let worgUserList = self.worgs.getUserList( worgId, true );
	worgUserList.forEach( accId => add( accId, addedOnline )); // only adding online? should it be all?
	addedOnline.forEach( accId => add( accId, worgUserList ));
	
	function add( accId, list ) {
		let acc = self.accounts[ accId ];
		if ( !acc || acc.closed )
			return;
		
		acc.addContacts( list );
	}
}

ns.UserCtrl.prototype.handleIdAdd = function( id ) {
	const self = this;
	//log( 'handleIdAdd, aborted', id );
	return;
	
	if ( id.fIsDisabled )
		return;
	
	const worgs = self.worgs.getMemberOf( id.clientId );
	const contacts = self.worgs.getContactList( id.clientId );
}

ns.UserCtrl.prototype.handleIdUpdate = function( update ) {
	const self = this;
	const accId = update.clientId;
	if ( 'fIsDisabled' == update.key ) {
		self.handleUserDisableChange( update );
		return;
	}
	
	if ( 'isOnline' == update.key )
		self.handleIdOnline( accId, update.value );
	
	//const affectedOnline = self.worgs.getContactList( accId, true );
	self.accIds.forEach( cId => {
		const acc = self.accounts[ cId ];
		if ( !acc || acc.closed )
			return;
		
		acc.updateIdentity( update );
	});
}

ns.UserCtrl.prototype.handleIdOnline = function( accId, isOnline ) {
	const self = this;
	const affected = self.worgs.getContactList( accId, isOnline );
	log( 'handleIdOnline', [ accId, isOnline, affected ])
	affected.forEach( cId => {
		const acc = self.accounts[ cId ];
		if ( !acc )
			return;
		
		if ( isOnline )
			acc.addContact( accId );
		else
			acc.removeContact( accId );
	});
}

ns.UserCtrl.prototype.handleUserDisableChange = function( idUpdate ) {
	const self = this;
	const accId = idUpdate.clientId;
	const isDisabled = idUpdate.value;
	if ( isDisabled )
		disable( accId, idUpdate );
	else
		enable( accId, idUpdate );
	
	async function enable( accId, uptd ) {
		const roomDb = new dFace.RoomDB( self.dbPool );
		const affected = await roomDb.getRelationListFor( accId );
		affected.forEach( contactId => {
			const acc = self.accounts[ contactId ];
			if ( null == acc )
				return;
			
			acc.addRelation( accId );
		});
		
		roomDb.close();
	}
	
	async function disable( accId, uptd ) {
		const roomDb = new dFace.RoomDB( self.dbPool );
		const affected = await roomDb.getRelationListFor( accId );
		affected.forEach( contactId => {
			const acc = self.accounts[ contactId ];
			if ( null == acc )
				return;
			
			acc.removeRelation( accId );
		});
		
		roomDb.close();
		self.remove( accId );
	}
}

ns.UserCtrl.prototype.handleInvalidateANCache = function( time ) {
	const self = this;
	self.accIds.forEach( accId => {
		const account = self.accounts[ accId ];
		account.invalidateANCache();
	});
}

/*
ns.UserCtrl.prototype.handleWorgUserRemoved = function( removedAccId, worgId ) {
	const self = this;
	const worgUsers = self.worgs.getUserList( worgId );
	worgUsers.forEach( removeContact );
	
	function removeContact( accId ) {
		let acc = self.accounts[ accId ];
		if ( !acc )
			return;
		
		acc.removeContact( removedAccId );
	}
}
*/

ns.UserCtrl.prototype.handleWorgRegenerate = function( affectedAccIds, added, removed ) {
	const self = this;
	log( 'handleWorgRegnerate', [ affectedAccIds, added , removed ])
	affectedAccIds.forEach( accId => {
		const acc = self.accounts[ accId ];
		if ( !acc || acc.closed )
			return;
		
		acc.updateWorkgroupContacts();
	});
}

ns.UserCtrl.prototype.updateUserWorgs = function( id ) {
	const self = this;
	if ( null == id.groups )
		return;
	
	if ( id.fIsDisabled )
		id.groups = [];
		
	self.worgs.updateUserWorgs( id.clientId, id.groups );
}

ns.UserCtrl.prototype.normalizeFUser = function( fUser ) {
	const self = this;
	const id = {
		clientId    : null,
		fUserId     : fUser.userid || fUser.UniqueId || null,
		fUsername   : fUser.name || fUser.Name || null,
		fLastUpdate : ( fUser.lastupdate != null ) ? parseInt( fUser.lastupdate ) : null,
		fIsDisabled : !!fUser.isdisabled,
		isAdmin     : ( 'Admin' === fUser.Level ),
		name        : fUser.fullname || fUser.FullName || null,
		avatar      : null,
	};
	
	if ( null == id.fUserId && null == id.fUsername ) {
		log( 'normalizeUser - invalid friend user', fUser );
		return null;
	}
	
	if ( fUser.groups ) {
		id.groups = fUser.groups
			.map( fId => self.worgs.getFIdToCId( fId ))
			.filter( cId => !!cId );
	}
	
	return id;
}

module.exports = ns.UserCtrl;
