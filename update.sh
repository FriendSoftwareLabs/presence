#!/usr/bin/env bash

# update.sh
# Copies the modified files in the friendchat/server directory to
# the proper location in Friend build directory structure.

# Edit this line if your Friend directory is not the same as this one
FRIEND="/home/$USER/friendup"

echo "Stopping presence-server system service"
sudo systemctl stop presence-server

# Eventually asks for the good directory
if [ ! -f "$FRIEND/build/cfg/cfg.ini" ]; then
    while true; do
        temp=$(dialog --backtitle "Friend Chat client update" --inputbox "\
Please enter the path to the FriendUP directory." 11 60 "$FRIEND" --output-fd 1)
        if [ $? = "1" ]; then
            clear
            echo "Update aborted."
            exit 1
        fi
        if [ $temp != "" ]; then
            FRIEND="$temp"
        fi

        # Verifies the directory
        if [ ! -f "$FRIEND/build/cfg/cfg.ini" ]; then
            dialog --backtitle "Friend Chat client update" --msgbox "\
Friend was not found in this directory,\n\
or Friend was not properly installed." 10 50
        else
            clear
            break;
        fi
    done
fi

# Creates destination directory if it does not exist
PRESENCE_SERVER="$FRIEND/build/services/Presence"
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
rm -f ${FRIEND}/build/autostart/startpresence.sh

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
