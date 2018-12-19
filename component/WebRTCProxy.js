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

const Emitter = require( './Events' ).Emitter;
const log = require( './Log' )( 'WebRTCProxy' );
//const uuid = require( './UuidPrefix' )( '' );
const child = require( 'child_process' );
const util = require( 'util' );

const ns = {};
ns.WebRTCProxy = function() {
	const self = this;
	
	Emitter.call( self );
	
	self.init();
}

util.inherits( ns.WebRTCProxy, Emitter );

// Public

/*
	inherits interface of Emitter
*/

ns.WebRTCProxy.prototype.send = function( event, callback ) {
	const self = this;
	log( 'send', event );
	self.conn.send( event, callback );
}

ns.WebRTCProxy.prototype.close = function() {
	const self = this;
	self.emitterClose();
	
	if ( self.conn ) {
		try {
			self.conn.removeAllListeners();
			self.conn.disconnect();
		} catch( e ) {}
	}
	
	delete self.conn;
}

// private

ns.WebRTCProxy.prototype.init = function() {
	const self = this;
	log( 'WebRTCProxy.init' );
	const conf = {
		foo : 'bar',
	};
	
	try {
		self.conn = child.fork( './component/WebRTCProxyChild.js' );
	} catch ( ex ) {
		log( 'init - child ex', ex );
	}
	
	self.conn.on( 'exit', onExit );
	self.conn.on( 'error', onError );
	self.conn.on( 'message', onMessage );
	
	self.send( 'hepp' );
	
	function onExit( e ) {
		log( 'conn exit', e );
		self.emit( 'exit' );
	}
	
	function onError( err ) {
		log( 'conn error', err );
	}
	
	function onMessage( str ) {
		log( 'conn message', str );
		self.emit( 'message', )
	}
	
	function stdOut( str ) {
		log( 'child.stdOut', str );
	}
}



module.exports = ns.WebRTCProxy;