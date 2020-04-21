# Janus

This document describes the install and config process for running Janus as a service
for Presence, on Ubuntu 16 and 18.

It also details some problems that have been encountered, and steps to solve them.
If you are not installing the on tested systems, you might enocounter other problems,
or have different solutions.

Default install instructions at
https://janus.conf.meetecho.com/docs/README.html

## libnice

```
git clone https://gitlab.freedesktop.org/libnice/libnice
	cd libnice
	./autogen.sh
	./configure --prefix=/usr
	make && sudo make install
```

If it complains about missing dependencies, and glib is one of them, install that first

### glib

glib requires 'meson' to build ( see below )

glib on apt-get might be version is 2.48, and does not work with libnice. You may have to build it yourself:
http://linuxfromscratch.org/blfs/view/svn/general/glib2.html

if  you already have glib wrong version, it must be removed. This error message is a
 indicator you still have old files:
`./janus: symbol lookup error: /usr/lib/x86_64-linux-gnu/libgobject-2.0.so.0: undefined symbol: g_date_copy`

You are supposed to only have:

`/usr/lib/x86_64-linux-gnu/libglib-2.0.so*`

You might also have:

`/lib/x86_64-linux-gnu/libglib-2.0.so*`

more info:
http://debian.2.n7.nabble.com/Bug-896019-libglib2-0-0-undefined-symbol-g-date-copy-breaking-many-programs-td4313288.html

removing the offending file should work maybe.

### meson
if it turns out you need meson, you might or might not also not end up with the correct
version of that.
If not, install with pip3 ( python3 thingie ):
`pip3 install meson==0.52.1`

if that doesnt work:
https://mesonbuild.com/Quick-guide.html#installation-from-source

## libsrtp

```
wget https://github.com/cisco/libsrtp/archive/v2.2.0.tar.gz
	tar xfv v2.2.0.tar.gz
	cd libsrtp-2.2.0
	./configure --prefix=/usr --enable-openssl
	make shared_library && sudo make install
```

## websockets

```
git clone https://github.com/warmcat/libwebsockets.git
	cd libwebsockets
	# If you want the stable version of libwebsockets, uncomment the next line
	#git checkout v2.4-stable
	mkdir build
	cd build
	# See https://github.com/meetecho/janus-gateway/issues/732 re: LWS_MAX_SMP
	cmake -DLWS_MAX_SMP=1 -DCMAKE_INSTALL_PREFIX:PATH=/usr -DCMAKE_C_FLAGS="-fpic" ..
	make && sudo make install
```

## actually building janus

This is reproduced from install_janus.sh, in case you experience problems and need to 
do it step by step:

```
git clone https://github.com/meetecho/janus-gateway.git
cd janus-gateway
sh autogen.sh
./configure --prefix=/opt/janus
```

At this point you should check output of configure step and
make sure websockets are enabled. If not, you might have an old version
of libwebsockets somewhere. `pkg-config --modversion libwebsockets` should output
version 3.something, and certainly not 1.something. `sudo apt-get purge libwebsockets-dev`
might help, if not you need to manualy remove it somehow.

```
make
sudo make install
```


Janus installs itself to `/opt/janus` and is run with `./janus` in `/opt/janus/bin/` 
as superuser. It should be able to start now.

If janus complains about missing libraries, this might work

`export LD_LIBRARY_PATH=/usr/local/lib`

# janus configuration

to initially write configs to the install folder:
`sudo make configs`
WARNING: This will overwrite current confings, 
so if you have already made changes, copy them.

config files are in `/opt/janus/etc/janus/`
( make sure to remove leading # for settings that should be enabled/used )

### janus.jcfg

```
plugins : {
	disable = "libjanus_echotest.so,libjanus_recordplay.so,libjanus_textroom.so,libjanus_voicemail.so"
}
```

Websocket is used for normal sessions, http is used for streaming. All other can be disabled:
```
transports : {
	disable = "libjanus_http.so,libjanus_pfunix.so,libjanus_nanomsg.so"
}
```

If the host setup is weird with regards to ip's visible to Janus and what is visible to the world
you might be able to solve it with setting:
```
nat : {
	...
	nat_1_1_mapping = "<public ip>"
	...
}
```

If not, make sure Janus has a public ip for peer webRTC to connect to.

### janus.transports.websockets.jcfg

```
general : {
	...
	json = "compact"
	ws = true
	ws_port = 13131
	ws_acl = "127.0.0.1"
	...
}
```

### janus.plugins.videoroom.jcfg

For streaming, for each room that can be a streaming room, there must be a room added to janus cfg.
These are called room-<number> in config. The excact name isnt important as it is not assigned to
a specific streaming room, but there must be enough rooms defined to cover max number of streaming
sessions in presence.

## presence configuration

services/Presence/config.js

To enable janus as a webRTC bridge
```
server : {
	...
	live : {
		...
		webRTCProxy : 'janus',
	},
	janus       : {
		domain     : 'localhost',
		port       : 13131,
	},
}
```

To record audio/video server side
```
server : {
	...
	live : {
		...
		recordLive   : true,
		recordFolder : '/full/path/to/folder/',
	},
}
```

if recordFolder is not defined recordings will be saved to 
services/Presence/janus/rec/

### streaming
in presence config
```
server : {
	...
	janus : {
		...
		api_url    : <must match janus.transport.http config>,
	},
}
```

Friend must have server settings to enable streaming workgroups.
How this is done is left as an exercise to the reader.
