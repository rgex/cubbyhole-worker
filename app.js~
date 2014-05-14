var fs = require('fs');
var express = require("express");
var bodyParser = require('body-parser');

/***
 *  creation of webserver
 *  Port 3000
 ***/
var app = express();
app.listen(3000);
app.use(bodyParser());

/***
*
*	list folders
*	@require 
*	- masterKey
*	- userId
*	
*
***/

app.post('/createUser', function(req, response){

	//check masterKey
   	var userId = req.body.userId;
	fs.mkdirSync('/iscsi/' + userId,0777);
	response.end('{"result":"success"}');
});

/***
*
*	list folders
*	@require 
*	- token
*	- path
*	
*
***/

app.post('/list', function(req, response){

   //get userId with token
   var userId = 1;
   var path = '/';

   if(typeof req.body !== 'undefined'
      && typeof req.body.path !== 'undefined'
      && req.body.path !== '')
	path = req.body.path;
   var path = '/iscsi/' + userId + path;

   var readdir = fs.readdirSync(path);
   var jsonResponse = new Array();
   for(var i in readdir)
   {
	if(fs.lstatSync(path + readdir[i]).isDirectory())
		jsonResponse.push(new Array('D',readdir[i],'0'));
	else {
		var fileStats = fs.statSync(path + readdir[i]);
		var fileSize  = fileStats['size'] / 1000.0;
		jsonResponse.push(new Array('F',readdir[i],fileSize));
	}
   }

   response.setHeader('Access-Control-Allow-Origin', '*');

   response.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
   response.end(JSON.stringify(jsonResponse).toString('utf8'));
   
});

//TODO Upload, move, copy, delete
