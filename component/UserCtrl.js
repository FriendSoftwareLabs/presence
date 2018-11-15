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
const Account = require( './Account' );
const Guest = require( './GuestAccount' );

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
	self.broadcastOnlineStatus( accId, true );
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
	
	self.idc.setOnline( accountId, false );
	self.broadcastOnlineStatus( accountId, false );
	delete self.accounts[ accountId ];
	self.accIds = Object.keys( self.accounts );
	acc.close();
	
	self.worgs.removeUser( accountId );
}

ns.UserCtrl.prototype.close = function() {
	const self = this;
	delete self.dbPool;
	delete self.worgs;
	delete self.roomCtrl;
}

// Private

ns.UserCtrl.prototype.init = function( dbPool ) {
	const self = this;
	log( ':3' );
	
	self.worgs.on( 'user-add', ( accId, worgId ) =>
		self.handleWorgUserAdded( accId, worgId ));
	self.worgs.on( 'user-remove', ( accId, worgId ) =>
		self.handleWorgUserRemoved( accId, worgId ));
}

ns.UserCtrl.prototype.handleWorgUserAdded = async function( addedAccId, worgId ) {
	const self = this;
	let worgUserList = self.worgs.getUserList( worgId );
	worgUserList.forEach( addTo );
	function addTo( accId ) {
		let acc = self.accounts[ accId ];
		if ( !acc )
			return;
		
		acc.addContact( addedAccId );
	}
}

ns.UserCtrl.prototype.handleWorgUserRemoved = function( removedId, memberOf ) {
	const self = this;
	memberOf.forEach( notifyOthers );
	function notifyOthers( worgId ) {
		const worgUsers = self.worgs.getUserList( worgId );
		worgUsers.forEach( removeContact );
	}
	
	function removeContact( accId ) {
		let acc = self.accounts[ accId ];
		if ( !acc )
			return;
		
		acc.removeContact( removedId );
	}
}

ns.UserCtrl.prototype.broadcastOnlineStatus = function( subjectId, isOnline ) {
	const self = this;
	const subAcc = self.accounts[ subjectId ];
	const contacts = subAcc.getContactList() || [];
	contacts.forEach( cId => {
		const acc = self.accounts[ cId ];
		if ( !acc || !acc.updateContactStatus )
			return;
		
		acc.updateContactStatus( subjectId, 'online', isOnline );
	});
}

ns.UserCtrl.prototype.updateOnlineStatus = function( accountId ) {
	const self = this;
	let account = self.accounts[ accountId ];
	if ( !account || !account.updateContactStatus )
		return;
	
	const contacts = account.getContactList() || [];
	contacts.forEach( cId => {
		let contact = self.accounts[ cId ];
		if ( !contact )
			return;
		
		account.updateContactStatus( cId, 'online', true );
	});
}

module.exports = ns.UserCtrl;
