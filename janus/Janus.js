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
 * speed in streaming ( aka classroom ) mode, eg. one teacher and 30 students.
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
const log = require( '../component/Log' )( 'Janus' );
const Emitter = require( '../component/Events' ).Emitter;
const util = require( 'util' );

const ns = {};

ns.Janus = function( type, jConf, pConf ) {
	const self = this;
	Emitter.call( self );
	const mod = self.modules[ type ];
	
	log( 'Janus', {
		type  : type,
		jConf : jConf,
		pConf : pConf,
		mod   : mod,
	});
	const jConfStr = JSON.stringify( jConf );
	const pConfStr = JSON.stringify( pConf );
	
	try {
		self.conn = child.fork( mod, [
			jConfStr,
			pConfStr,
		]);
	} catch ( ex ) {
		log( 'subprocess start expcetion ', ex );
		return;
	}
	
	self.open = true;
	self.conn.on( 'error', on_error );
	self.conn.on( 'message', e => self.handleConnMsg( e ));
	self.conn.on( 'exit', e => self.cleanup( 'PROCESS_EXIT' ));
	
	function on_error( err ) {
		log( 'conn error', err );
	}
	
	self.conn_map = {
		'signal' : to_signal,
		'close'  : close,
	}
	
	function to_signal( e ) { self.emitSignal( e ); }
	function close( e ) { self.handleClose( e ); }
}

util.inherits( ns.Janus, Emitter );

ns.Janus.prototype.modules = {
	'star'   : './janus/Star.js',
	'stream' : './janus/Stream.js',
}

// Public

ns.Janus.prototype.setSource = function( source_id ) {
	const self = this;
	log( 'setSource', source_id );
	const set_source = {
		type : 'set_source',
		data : source_id,
	};
	self.send( set_source );
}

ns.Janus.prototype.setRecording = function( is_recording ) {
	const self = this;
	log( 'setRecording', is_recording );
	const rec = {
		type : 'set_recording',
		data : is_recording,
	};
	self.send( rec );
}

ns.Janus.prototype.addUser = function( user_id ){
	const self = this;
	log( 'addUser', user_id );
	const add = {
		type : 'add_user',
		data : user_id,
	};
	self.send( add );
	
}

ns.Janus.prototype.removeUser = function ( user_id ){
	const self = this;
	log( 'removeUser', user_id );
	self.send({
		type : 'remove_user',
		data : user_id,
	});
}

ns.Janus.prototype.handleSignal = function( event, user_id ) {
	const self = this;
	//log( 'handleSignal', event );
	const signal = {
		type : 'signal',
		data : {
			event   : event,
			user_id : user_id,
		},
	};
	
	self.send( signal );
}

ns.Janus.prototype.close = function() {
	const self = this;
	if ( !self.conn || !self.open )
		return;
	
	self.open = false;
	self.closing = true;
	self.send({
		type : 'close',
	});
	
	self.close_timeout = setTimeout( cleanup, 1000 * 5 );
	function cleanup() {
		self.cleanup( 'CLOSE_TIMEOUT_HIT' );
	}
}

// Private

ns.Janus.prototype.handleClose = function( reason ) {
	const self = this;
	self.open = false;
	self.cleanup( reason );
}

ns.Janus.prototype.cleanup = function( reason ) {
	const self = this;
	self.open = false;
	reason = reason || 'CLEANUP_NO_REASON_GIVEN';
	log( 'cleanup', reason );
	if ( null != self.close_timeout ) {
		clearTimeout( self.close_timeout );
		delete self.close_timeout;
	}
	
	self.emit( 'closed', reason );
	self.emitterClose();
	
	if ( self.conn ) {
		try {
			self.conn.removeAllListeners();
			self.conn.on( 'error', e => {});
			self.conn.disconnect();
		} catch( e ) {}
	}
	
	delete self.conn;
}

//send data to child process
ns.Janus.prototype.send = function( event, callback ) {
	const self = this;
	if ( !self.conn )
		return;
	
	log( 'to janus', event, 4 );
	const eventStr = JSON.stringify( event );
	self.conn.send( eventStr, callback );
}

// handle data from child process
ns.Janus.prototype.handleConnMsg = function( msg ) {
	const self = this;
	if ( !self.open )
		return;
	
	let event = null;
	try {
		event = JSON.parse( msg );
	} catch ( ex ) {
		log( 'handleConnMsg - invalid data', msg );
		return;
	}
	
	log( 'from janus', event, 4 );
	let handler = self.conn_map[ event.type ];
	if ( !handler ) {
		log( 'handleConnMsg - no handler for', event );
		return;
	}
	
	handler( event.data );
}

// emit to parent system
ns.Janus.prototype.emitSignal = function( conf ) {
	const self = this;
	self.emit(
		'signal',
		conf.event,
		conf.user_id
	);
}

module.exports = ns.Janus;
