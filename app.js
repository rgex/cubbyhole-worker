var fs = require('fs');
var net = require('http');
var express = require("express");
var bodyParser = require('body-parser');

/***
 *  création du socket pour l'upload
 *
 ***/

var handleHttpReq = function (req, res) {
  var body = "";
  req.on('data', function (chunk) {
    body += chunk;
    req.pause();
    setTimeout(function() {
   	 console.log('now data will start flowing again');
    	req.resume();
    }, 1000);
  });
  req.on('end', function () {
    //console.log('POSTed: ' + body);
    res.writeHead(200);
    res.end("");
  });
}

var socketServer = net.createServer(handleHttpReq)
.listen(9999, function(){
        console.log('SOCKET SERVER Listening at: http://localhost:9999');
});



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

//TODO upload,download , move, copy, delete
