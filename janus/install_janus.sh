#!/bin/bash

echo "*** pkg-config"
sudo apt-get install -y pkg-config

echo "*** common dependencies"
sudo apt-get install -y libmicrohttpd-dev libjansson-dev \
		libssl-dev libsrtp-dev libsofia-sip-ua-dev \
		libopus-dev libogg-dev libcurl4-openssl-dev liblua5.3-dev \
		libconfig-dev gengetopt libtool automake

echo "*** done with common derps, checking specifics"

echo "*** checking for libnice"
niceRes=$(pkg-config --list-all | grep libnice)
if [ ! "$niceRes" ]
then
	echo "libnice required, not found, check README"
	exit 1
fi

echo "*** checking for libsrtp"
srtpRes=$(pkg-config --list-all | grep libsrtp2)
if [ ! "$srtpRes" ]
then
	echo "libsrtp2 required, not found, check README"
	exit 1
fi

#echo "*** nanomsg"
#sudo apt-get install -y libnanomsg-dev

echo "*** checking for libwebsockets"
wsRes=$(pkg-config --list-all | grep websocket)
echo "wsRes $wsRes"
if [ ! "$wsRes" ]
then
	echo "libwebsockets required, not found, check README"
	exit 1
fi

echo "*** janus"
git clone https://github.com/meetecho/janus-gateway.git
cd janus-gateway
sh autogen.sh
./configure --prefix=/opt/janus
make
sudo make install

# you might have to do this maybe?
export LD_LIBRARY_PATH=/usr/local/lib

# if janus refuses to start with
# ./janus: symbol lookup error: /usr/lib/x86_64-linux-gnu/libgobject-2.0.so.0:
# undefined symbol: g_date_copy

# then you have files from an old version of glib 

# janus installs itself in /opt/janus/

# janus should be able to start now, so stop it again :D

# in etc/janus, cahnge config janus.transports.nanomsg.jcfg
#json="compact"
#address="tcp://127.0.0.1:13131"
