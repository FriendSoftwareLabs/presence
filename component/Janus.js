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

/* This is a plugin that allows to use Janus WebRTC conferencing server instead
 * of connecting every client P2P. It is used to reduce the required upload
 * speed in presentation (or classroom) mode, eg. one teacher and 30 students.
 * Janus server handles the bandwidth for those 30 clients.
 *
 * This plugin processes some events from clients and sends events to child processes.
 * The chils generates appropriate Janus HTTP REST API calls (eg. room setup, SDP negotiation).
 * Messages between the parent and child are JSON strings.
 *
 * Janus API URL and API key have to be set in config.js server section.
 * Example:
 *
 * janus : {
 *       api_url : "https://some.server.blah:8089/janus/",
 *       api_key : "janusrocks",
 *   },
 *
 * Each instance of this class handles a single room.
 */

'use strict';

const child = require( 'child_process' );
const log = require( './Log' )( 'Janus' );
const Emitter = require( './Events' ).Emitter;
const util = require( 'util' );

const ns = {};

ns.Janus = function( conf ) {
	const self = this;
	Emitter.call( self );
	
	try {
		self.conn = child.fork( './component/Janus_child.js', [
			conf.api_url,
			conf.api_key,
		]);
	} catch ( ex ) {
		log( 'subprocess start expcetion ', ex );
	}
	
	self.open = true;
	self.conn.on( 'exit', on_exit );
	self.conn.on( 'error', on_error );
	self.conn.on( 'message', on_message );
	
	function on_exit( e ) {
		self.cleanup( 'PROCESS_EXIT' );
	}
	
	function on_error( err ) {
		log( 'conn error', err );
	}
	
	function on_message( str ) {
		let msg = null;
		try {
			msg = JSON.parse( str );
		} catch ( ex ) {
			log( 'on_message - invalid data', str );
		}
		self.handle_conn_msg( msg );
	}
	
	self.conn_map = {
		'signal' : to_signal,
		'close'  : close,
	}
	
	function to_signal( e ) { self.emit_signal( e ); }
	function close( e ) { self.handle_close( e ); }
}

util.inherits( ns.Janus, Emitter );

// Public

ns.Janus.prototype.set_source = function( source_id ) {
	const self = this;
	const set_source = {
		type : 'set_source',
		data : source_id,
	};
	self.send( set_source );
}

ns.Janus.prototype.add_user = function( user_id ){
	const self = this;
	const add = {
		type : 'add_user',
		data : user_id,
	};
	self.send( add );
	
}

ns.Janus.prototype.remove_user = function ( user_id ){
	const self = this;
	self.send({
		type : 'remove_user',
		data : user_id,
	});
}

ns.Janus.prototype.handle_signal = function( event, user_id ) {
	const self = this;
	const signal = {
		type : 'signal',
		data : {
			event   : event,
			user_id : user_id,
		},
	};
	self.send( signal );
}

ns.Janus.prototype.close = function( callback ) {
	const self = this;
	if ( !self.conn || !self.open ) {
		if ( callback )
			callback( true );
		
		return;
	}
	
	self.open = false;
	self.close_callback = callback;
	self.send({
		type : 'close',
	});
	
	self.close_timeout = setTimeout( cleanup, 1000 * 5 );
	function cleanup() {
		self.cleanup();
	}
}

// Private

ns.Janus.prototype.handle_close = function( reason ) {
	const self = this;
	self.open = false;
	self.cleanup( reason );
}

ns.Janus.prototype.cleanup = function( reason ) {
	const self = this;
	reason = reason || 'CLEANUP_NO_REASON_GIVEN';
	if ( null != self.close_timeout )
		clearTimeout( self.close_timeout );
	
	delete self.close_timeout;
	
	let closed = self.close_callback;
	if ( !closed )
		self.emit( 'closed', reason );
	
	delete self.close_callback;
	
	self.emitterClose();
	if ( self.conn ) {
		try {
			self.conn.removeAllListeners();
			self.conn.disconnect();
		} catch( e ) {}
	}
	
	delete self.conn;
	
	if ( closed )
		closed( reason );
}

//send data to child process
ns.Janus.prototype.send = function( event, callback ) {
	const self = this;
	if ( !self.conn )
		return;
	
	const eventStr = JSON.stringify( event );
	self.conn.send( eventStr, callback );
}

ns.Janus.prototype.handle_conn_msg = function( event ) {
	const self = this;
	if ( !self.open )
		return;
	
	let handler = self.conn_map[ event.type ];
	if ( !handler ) {
		log( 'handle_conn_msg - no handler for', event );
		return;
	}
	
	handler( event.data );
}

ns.Janus.prototype.emit_signal = function( conf ) {
	const self = this;
	self.emit(
		'signal',
		conf.event,
		conf.user_id
	);
}

module.exports = ns.Janus;
