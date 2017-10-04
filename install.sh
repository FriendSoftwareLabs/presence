#! /bin/bash

echo "Presence installer.."
echo "Checking for node.js and npm"

installNode() {
	curl -L http://git.io/n-install | bash
}

nv=$(node -v)
npm=$(npm -v)
if [ -z $nv ]; then
	echo "Node.js was not found. If you want to install manually, see node.txt"
	read -r -p "Install node? [y/N] " response
	case $response in
		[yY][eE][sS]|[yY]) 
			installNode
			;;
		*)
			exit 0
			;;
	esac
fi

if [ "v8.6.0" \> $nv ]; then
	echo "Warning : node version"
	echo "found: $nv"
	echo "recomended : v8.6.0"
	echo "see node.txt for instructions"
	read -r -p "continue anyway? [y/N] " response
	case $response in
		[yY][eE][sS]|[yY]) 
			echo "okidoki"
			;;
		*)
			exit 0
			;;
	esac
fi

if [ -z $npm ]; then
	echo "node found, but not npm, see node.txt for instruction - aborting"
	exit 0
fi

echo "installing node modules with npm:"
npm update

echo "Setting up database"
dbhost=""
dbport=""
dbuser=""
dbpass=""
dbname=""

# read from file, get things from 'mysql' to '}'
db=$(sed -n '/mysql/, /}/ p' config.js)
# remove whitesapce
nospace=$( echo $db | sed -r 's/[[:space:]]//g')
# remove to and including '{'
removefront="${nospace#*{}"
# remove from behind to and including '}'
pairs="${removefront%\}*}"
#split pairs on ',' into an array of key value pairs
IFS=',' read -ra pairsArr <<< "$pairs"
for pair in  ${pairsArr[@]}; do
	#split pair into key and value
	IFS=':' read -ra pairArr <<< "$pair"
	key=${pairArr[0]}
	quotedValue=${pairArr[1]}
	#remove singlequotes from value
	value=$( echo $quotedValue | sed "s/'//g")
	#read into variable
	if [ "host" == $key ]
		then
		dbhost=$value
	fi
	if [ "port" == $key ]
		then
		dbport=$value
	fi
	if [ "user" == $key ]
		then
		dbuser=$value
	fi
	if [ "pass" == $key ]
		then
		dbpass=$value
	fi
	if [ "name" == $key ]
		then
		dbname=$value
	fi
done

echo ""
echo "The following values were found in the config:"
echo "host: $dbhost"
echo "port: $dbport"
echo "user: $dbuser"
echo "password: $dbpass"
echo "database: $dbname"

#
echo ""
echo "Please provide mysql admin credentials:"
read -r -p "admin user: " dbAdminUser
read -r -s -p "admin pass: " dbAdminPass

# Temporary store the password in system variable to avoid warnings
export MYSQL_PWD=$dbAdminPass

# Connection strings
mysqlAdminConnect="--host=$dbhost --port=$dbport --user=$dbAdminUser"
mysqlconnect="--host=$dbhost --port=$dbport --user=$dbuser"
mysqlconnectdb=$mysqlconnect" --database=$dbname"

# Checks if user is already present or not, and creates it eventually
echo ""
echo ""
userRes=$(mysql $mysqlAdminConnect \
	--execute="SELECT mu.User FROM mysql.user AS mu WHERE mu.User='$dbuser'") 
userExists="${userRes#*User}"
userExists=$( echo $userExists | sed -r 's/[[:space:]]//g')
if [ "$userExists" == "$dbuser" ]; then
	echo "User $dbuser already exists, skipping"
else
	echo "Setting up user: $dbuser"
	# Creates user
	mysql $mysqlAdminConnect \
		--execute="CREATE USER $dbuser@$dbhost IDENTIFIED BY '$dbpass';" 
fi

# Checks if database is already created
dbpresent=$(mysql $mysqlAdminConnect \
	--execute="SHOW DATABASES LIKE '$dbname'")
if [[ $dbpresent == *"$dbname"* ]]; then
	echo "Database $dbname was found, skipping"
else
	# Creates database
	echo "Creating database: $dbname"
	mysql $mysqlAdminConnect \
		--execute="CREATE DATABASE $dbname" 
	# Grants access to db
	mysql $mysqlAdminConnect \
		--execute="GRANT ALL PRIVILEGES ON $dbname.* TO $dbuser@$dbhost;" 
	# Cleans memory
	mysql $mysqlAdminConnect \
		--execute="FLUSH PRIVILEGES;" 
	# Switch to user
	export MYSQL_PWD=$dbpass
	# Creates tables
	echo "Creating tables"
	mysql $mysqlconnectdb \
		--execute="SOURCE db/tables.sql" 
fi

# Switch to user if not already done
export MYSQL_PWD=$dbpass

echo "Running update procedures"
mysql $mysqlconnectdb \
	--execute="SOURCE db/procedures.sql" 

# Deletes dangerous variable
export MYSQL_PWD=''

echo ""
echo "Database setup complete."
echo "Installation complete."
echo ""

