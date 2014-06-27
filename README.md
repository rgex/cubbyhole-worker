This is a Supinfo group project.
---
**The team members are :**

 * 124898 Jan Moritz LINDEMANN
 * 164271 Lionel CHRISTANVAL
 * 165003 Steeve BULGARE
 * 162095 Jérémy CETOUT
 * 164340 Mike ROUSSEAEU

The project can be downloaded here :

 - https://github.com/rgex/cubbyhole-server/blob/master/M1%20-%20Cubbyhole.pdf?raw=true

Other related project repositories are :

 - https://github.com/rgex/cubbyhole-server

 - https://github.com/rgex/cubbyhole-mobileclient

 - https://github.com/rgex/cubbyhole-java


Worker Setup
---


**Install g++, Git, cURL**
```
apt-get install git curl g++
```
**Install nodejs**
```
wget http://nodejs.org/dist/v0.10.28/node-v0.10.28.tar.gz
tar -xvf node-v0.10.28
cd node-v0.10.28
./configure
make install
```
**Create the storage folder where a SAN can later be mounted on.**
```
mkdir /iscsi
chmod 777 iscsi
```
**Download the worker from the Github repository.**
```
cd /var
git clone https://github.com/rgex/cubbyhole-worker
cd /var/cubbyhole-worker
npm install
```
**Configuration of the worker.**
**Create a worker.config file like this**
```
{
	"webserviceHost" : "127.0.0.1",
	"webservicePath" : "/ws/"
}
```
**Update the worker**
```
cd /var/cubbyhole-worker
git pull
init 6
```
**Launch the worker**
```
node app.js
```
