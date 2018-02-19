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

/*
	Emitter, general event emitter class.
	So i dont have to use the node one ( my interface is superior :)))))))
	
	constructor arguments: 
	
	eventSink - function, optional - this is a default handler where all events
		that do not have handlers will be sent, but with the event type as first
		argument.
	
	Provides this interface:
	.on( eventTypeStr, listenerFn ), returns idStr for use in .off
		Listen for event of type
		
	.once( eventTypeStr, listenerFn ), no return value
		Listen for one event of type, then the listener is released
		
	.off( idStr ), return successBool
		Stop listening for event. idStr is the return value from .on
		
	.release( type ), type of event listeners to release - no return value
		Remove all listeners registered on the object, or specify listener type
		
	.emit( type, ...arguments ), returns null if event was emitted,
		otherwise returns a object with 'type' and arguments[]
		Arguments are applied to all registered listeners of the specified type.
*/

const log = require( './Log' )( 'Emitter' );
const uuid = require( './UuidPrefix' )( 'listener' );

var ns = {};

ns.Emitter = function( eventSink ) {
	if ( !( this instanceof ns.Emitter ))
		return new ns.Emitter( eventSink );
	
	const self = this;
	self._emitterEvent2ListenerId = {};
	self._emitterListeners = {};
	self._emitterEventSink = eventSink;
}

// first argument must be the event type, a string,
// send as many extra arguments as you wish, they will be passed to the handler
// no in args, you say? its voodoo magic, aka 'arguments' object
ns.Emitter.prototype.emit = function() {
	const self = this;
	var args = arguments;
	var event = args[ 0 ]; // first arguments passed to .emit()
	var handlerArgs = Array.prototype.slice.call( args, 1 ); // the other arguments
		// as an array that will be .apply to the listener
	
	const listenerIds = self._emitterEvent2ListenerId[ event ];
	if ( !listenerIds || !listenerIds.length ) {
		if ( self._emitterEventSink )
			self._emitterEventSink.apply( arguments );
		
		const unknownEvent = {
			type : event,
			arguments : handlerArgs,
		}
		return unknownEvent;
	}
	
	listenerIds.forEach( sendOnListener );
	return null;
	function sendOnListener( id ) {
		var listener = self._emitterListeners[ id ];
		if ( !listener ) {
			log( 'emit - getSub - no listener for id',
				{ id: id, listener : self._emitterListeners });
			return;
		}
		
		listener.apply( self, handlerArgs );
	}
}

ns.Emitter.prototype.on = function( event, listener ) {
	const self = this;
	var id = uuid.v4();
	var eventListenerIds = self._emitterEvent2ListenerId[ event ];
	if ( !eventListenerIds ) {
		eventListenerIds = [];
		self._emitterEvent2ListenerId[ event ] = eventListenerIds;
	}
	
	eventListenerIds.push( id );
	self._emitterListeners[ id ] = listener;
	
	return id;
}

ns.Emitter.prototype.once = function( event, listener ) {
	const self = this;
	var onceieId = self.on( event, onceie );
	
	function onceie( eventData ) {
		listener( eventData );
		self.off( onceieId );
	}
}

ns.Emitter.prototype.off = function( removeListenerId ) {
	const self = this;
	var events = Object.keys( self._emitterEvent2ListenerId );
	events.forEach( search );
	function search( event ) {
		var listenerIdArr = self._emitterEvent2ListenerId[ event ];
		var listenerIdIndex = listenerIdArr.indexOf( removeListenerId );
		if ( listenerIdIndex === -1 )
			return false;
		
		self._emitterEvent2ListenerId[ event ].splice( listenerIdIndex, 1 );
		delete self._emitterListeners[ removeListenerId ];
		return true;
	}
}

ns.Emitter.prototype.release = function( eventName ) {
	const self = this;
	if ( !eventName )
		releaseAll();
	else
		releaseAllOfType( eventName );
	
	function releaseAll() {
		self._emitterEvent2ListenerId = {};
		self._emitterListeners = {};
	}
	
	function releaseAllOfType( name ) {
		var idArr = self._emitterEvent2ListenerId[ name ];
		if ( !idArr || !idArr.length )
			return;
		
		idArr.forEach( remove );
		delete self._emitterEvent2ListenerId[ name ];
		
		function remove( id ) {
			delete self._emitterListeners[ id ];
		}
	}
}

ns.Emitter.prototype.emitterClose = function() {
	const self = this;
	self.release();
	delete self._emitterEventSink;
}


// EventNode
const nlog = require( './Log' )( 'EventNode' );
ns.EventNode = function( type, conn, sink ) {
	const self = this;
	self._eventNodeType = type;
	self._eventNodeConn = conn;
	self._eventNodeSink = sink;
	
	self.init();
}

ns.EventNode.prototype.eventNodeInit = function() {
	const self = this;
	nlog( 'init' );
}

module.exports = ns;
