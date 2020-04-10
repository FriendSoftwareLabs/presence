#!/bin/bash

baseDir=""
installDir="TURN-server"
installFrom=$(pwd)
gitRepo="https://github.com/coturn/coturn.git"

if [ ! -z $baseDir ]
then
	echo "baseDir found, installing to:" $baseDir"/"$installDir
else
	cd ..
	baseDir=$(pwd)
	installPath=$baseDir"/"$installDir
	echo "installing to:" $installPath
fi

echo "TURN - pre setup"
echo "Installing dependencies"

sudo apt-get install --yes libssl-dev
sudo apt-get install --yes libevent-dev
sudo apt-get install --yes libevent2

echo "TURN - cloning from git: " $gitRepo
cd $baseDir
git clone $gitRepo

echo "TURN - install"

cd $baseDir"/coturn"
./configure --prefix="/"$installDir
make
make DESTDIR=$baseDir install

echo "TURN - copy stuff"
cp $installFrom"/install.turnserver.conf" $installPath"/etc/turnserver.conf"
cp $installFrom"/phoenix_TURN.sh" $installPath"/phoenix_TURN.sh"

# lets not
#echo "TURN - generate TLS things"
#cd $installPath"/etc/"
#openssl req \
#	-new \
#	-newkey rsa:4096 \
#	-days 36500 \
#	-nodes \
#	-x509 \
#	-subj "/C=NO/ST=someplace/L=local/O=FSL/CN=FriendSoftwareLabs" \
#	-keyout turn_pkey.pem \
#	-out turn_cert.pem

echo "TURN - cleanup"
cd $baseDir
rm -rf coturn

echo "DONE"
