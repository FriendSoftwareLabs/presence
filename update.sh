#!/usr/bin/env bash

# update.sh
# Copies the modified files in the friendchat/server directory to
# the proper location in Friend build directory structure.

echo "Stopping presence-server system service"
sudo systemctl stop presence-server

FRIEND=""

if [ -f "fup.path" ]; then
    FRIEND=`cat fup.path`
    echo "found fup.path: $FRIEND"
fi

if [ -z "$FRIEND" ]; then
    FRIEND="/home/$USER/friendup"
fi

echo "FRIEND: $FRIEND"
FRIEND_CHECK=$FRIEND

# Eventually asks for the good directory
if [ ! -f "$FRIEND_CHECK/cfg/cfg.ini" ]; then
    while true; do
        temp=$(dialog --backtitle "Friend Chat update" --inputbox "\
Please enter the path to the FriendUP directory." 11 60 "$FRIEND_CHECK" --output-fd 1)
        if [ $? = "1" ]; then
            #clear
            echo "Update aborted."
            exit 1
        fi
        if [ $temp != "" ]; then
            FRIEND_CHECK="$temp"
        fi
        
        # Verifies the directory
        if [ ! -f "$FRIEND_CHECK/cfg/cfg.ini" ]; then
            dialog --backtitle "Friend Chat client update" --msgbox "\
Friend was not found in this directory,\n\
or Friend was not properly installed." 10 50
        else
            #clear
            break;
        fi
    done
fi

if [ "$FRIEND" != "$FRIEND_CHECK" ]; then
    echo "new path found: $FRIEND_CHECK"
    echo "$FRIEND_CHECK" > fup.path
    FRIEND="$FRIEND_CHECK"
fi

# Creates destination directory if it does not exist
PRESENCE_SERVER="$FRIEND/services/Presence"
if [ ! -d "$PRESENCE_SERVER" ]; then
    mkdir "$PRESENCE_SERVER"
fi

# Copy the files
echo "Copying files to $PRESENCE_SERVER directory."
rsync -ravl \
	--exclude '/.git*' \
	--exclude '/update.sh' \
	--exclude '/install.sh' \
	--exclude '/readme.txt' \
	--exclude '/node.txt' \
	--exclude '/README.md' \
	. "$PRESENCE_SERVER"

# Remove old startup script (if still exists)
rm ${FRIEND}/autostart/startpresence.sh

# Run npm
echo "Calling 'npm install'."
TEMP=$(pwd)
cd "$PRESENCE_SERVER"
npm install
cd "$TEMP"

# End
echo ""
echo "Update successfully completed."
echo "Starting presence-server system service"
sudo systemctl start presence-server

echo ""
