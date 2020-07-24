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
		self.roomCtrl
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
		return;
	}
	
	const id = self.normalizeFUser( fUser );
	if ( !id )
		return;
	
	log( 'update', id );
	const identity = await self.idc.update( id );
	if ( !identity )
		return;
	
	if ( id.groups )
		self.worgs.updateUserWorgs( identity.clientId, id.groups );
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

ns.UserCtrl.prototype.init = function( dbPool ) {
	const self = this;
	log( ':3' );
	self.service = new FService();
	self.serviceConn = new events.EventNode( 'user', self.service, serviceSink );
	self.serviceConn.on( 'update', e => self.handleFUserUpdate( e ));
	
	function serviceSink( ...args ) {
		log( 'serviceSink - user', args, 3 );
	}
	
	self.idc.on( 'add', e => self.handleIdAdd( e ));
	self.idc.on( 'update', e => self.handleIdUpdate( e ));
	
	self.worgs.on( 'users-added', ( worgId, accIds ) =>
		self.handleWorgUsersAdded( worgId, accIds ));
	self.worgs.on( 'regenerate', accIds => 
		self.handleWorgRegenerate( accIds ));
	
}

ns.UserCtrl.prototype.handleFUserUpdate = async function( fUpdate ) {
	const self = this;
	const fUId = fUpdate.userid;
	const fUser = await self.service.getUser( fUId );
	self.update( fUser );
	
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
		
		self.worgs.updateUserWorgs( id.clientId, groups );
	}
	
	update( fUId );
	
	async function update( fUId ) {
		const fUser = await self.service.getUser( fUId );
		self.update( fUser );
	}
	*/
}

ns.UserCtrl.prototype.handleWorgUsersAdded = async function( worgId, addedAccIds ) {
	const self = this;
	if ( !addedAccIds || !addedAccIds.length ) {
		log( 'handleWorgUsersAdded - not really', addedAccIds );
		return;
	}
	
	let worgUserList = self.worgs.getUserList( worgId );
	worgUserList.forEach( addTo );
	function addTo( accId ) {
		let acc = self.accounts[ accId ];
		if ( !acc || acc.closed )
			return;
		
		acc.addContacts( addedAccIds );
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
	if ( 'fIsDisabled' == update.type ) {
		const user = update.data;
		if ( user.fIsDisabled )
			self.remove( user.clientId );
		
	}
	
	self.accIds.forEach( id => {
		const acc = self.accounts[ id ];
		if ( !acc || acc.closed )
			return;
		
		acc.updateIdentity( update );
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

ns.UserCtrl.prototype.handleWorgRegenerate = function( affectedAccIds ) {
	const self = this;
	affectedAccIds.forEach( accId => {
		const acc = self.accounts[ accId ];
		if ( !acc || acc.closed )
			return;
		
		acc.updateContacts();
	});
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
