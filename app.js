var fs = require('fs');
var net = require('http');
var express = require("express");
var bodyParser = require('body-parser');
var multipart = require('multipart');
var qs = require('querystring');
var pathHelper = require('path');
var urlHelper = require('url');

/***
 *  création du socket pour l'upload
 *
 ***/

var handleHttpReq = function (req, res) {
	if (req.url === '/upload' && req.method === 'POST') {
		  var firstChunk = true;

		  req.on('request', function (req, res) {
		   	console.log(request);
		  });

		  req.on('data', function (chunk) {
		  	//if data is empty then we need to extract the headers from it
			if(firstChunk) {
				var i = 0;
				var done = false;
				var contentTypeFound = false;
				var postData = new Array();
				firstChunk = false;
				while(!done) {
					if(chunk.toString("utf-8",i,i+2) === "\x0D\x0A") {
						if(chunk.toString("utf-8",i,i+4) === "\x0D\x0A\x0D\x0A" && !contentTypeFound) {
							//get other post data
							var z = 0;
							while(chunk.slice(i+4+z,i+4+z+2).toString() !== "\x0D\x0A") {
								z++;
							}
							postData.push(chunk.slice(i+4,i+4+z).toString());
						}
						console.log("found line return");
						if(contentTypeFound) {
							done = true;
						}
						else if(chunk.toString("utf-8",i+2,i+2+12) === "Content-Type") {
							//TODO get filename
							contentTypeFound = true;
							var z = 1;
							while(chunk.slice(i-z,i-z+2).toString() !== "\x0D\x0A") {
								z++;
							}
							fileInfoChunk = chunk.slice(i-z,i).toString();
							fileNameRegex = new RegExp('filename="(.{1,})"','i');
							var res = fileNameRegex.exec(fileInfoChunk);
							var fileName = res[1];
						}
					}
					i++;
				}

				var token = postData[0];
				var path = postData[1];

				console.log("token : " + token);
				console.log("path : " + path);
				console.log("fileName : " + fileName);
				//TODO get userid and user infos speed, disk usage with token
				var userId = 1;
				var speed = 100; // ko/s

				if(fs.existsSync("/iscsi/" + userId + path + fileName) && fs.lstatSync("/iscsi/" + userId + path + fileName).isFile())
		    			fs.unlinkSync("/iscsi/" + userId + path + fileName);
				fd = fs.openSync("/iscsi/" + userId + path + fileName,'a');
		    		var nbrOfWritenBytes = fs.writeSync(fd, chunk.slice(i+3,chunk.length), 0, (chunk.length - (i+3)), 0);
				//console.log(chunk.toString());
				console.log("state 1");
			}
			else {
				console.log("state 2");
				//console.log(chunk.toString());
		    		nbrOfWritenBytes += fs.writeSync(fd, chunk, 0, chunk.length, nbrOfWritenBytes);
		    		req.pause();
		   		setTimeout(function() {
		   	 		console.log('now upload will start flowing again');
		    			req.resume();
		    		}, 10);
			}
		  });

		req.on('end', function () {

		    setTimeout(function() {
			    console.log("ended");
			    
			    res.writeHead(200);
			    res.end("");
		    },300);
		});
	}

	DownloadWTokenRegex = new RegExp('^.{0,}download/\\?userid=(.{1,})&file=(.{1,})&token=(.{1,})$','i'); //not very secured
	if(DownloadWTokenRegex.test(req.url)) { //download with token
		console.log("download with token");
		var resRegex = DownloadWTokenRegex.exec(req.url);
		var urlParts = urlHelper.parse(req.url, true);
		console.log(urlParts);
		var filePath = '/iscsi/' + urlParts.query.userid + urlParts.query.file;
   		var fileStat = fs.lstatSync(filePath);
		//res.writeHead(200);
		res.writeHead(200, { 'Content-Type': 'application/force-download', 'Content-Length': fileStat.size, 'Content-disposition' : 'attachment; filename=' + pathHelper.basename(filePath) });
		var readStream = fs.createReadStream(filePath, { bufferSize: 64 * 1024 });
		readStream.on("data", function(data) {
			readStream.pause();
		   	setTimeout(function() {
					res.write(data);
		   	 		console.log('now download will start flowing again');
		    			readStream.resume();
		    	}, 100);
		});

		readStream.on("end", function() {
			console.log("download done");
			setTimeout(function() {
					res.end("");
		    	}, 500);
		});
	}

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

	//TODO check masterKey
   	var userId = req.body.userId;
	fs.mkdirSync('/iscsi/' + userId,0777);
	response.setHeader('Access-Control-Allow-Origin', '*');
	response.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
	response.end('{"result":"success"}');
});

/***
*
*	create folder
*	@require 
*	- masterKey
*	- userId
*	
*
***/
app.post('/createFolder', function(req, response){

	//TODO get userID
   	var userId = 1;
	fs.mkdirSync('/iscsi/' + userId + req.body.path + req.body.folderName,0777);
	response.setHeader('Access-Control-Allow-Origin', '*');
	response.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
	response.end('{"result":"success"}');
});

var deleteFolderRecursive = function(path) {
  if( fs.existsSync(path) ) {
    fs.readdirSync(path).forEach(function(file,index){
      var curPath = path + "/" + file;
      if(fs.lstatSync(curPath).isDirectory()) { // recurse
        deleteFolderRecursive(curPath);
      } else { // delete file
        fs.unlinkSync(curPath);
      }
    });
    fs.rmdirSync(path);
  }
};

/***
*
*	delete a file or a folder
*	@require 
*	- path
*	- fileName
*	- token
*
***/
app.post('/delete', function(req, response){
	//TODO get userId with token

   	var userId = 1;
	var path = req.body.path;
	if(req.body.path.length === 0)
		path = '/';
	var fileName = req.body.fileName;
	if(fs.existsSync("/iscsi/" + userId + path + fileName) && fs.lstatSync("/iscsi/" + userId + path + fileName).isFile())
		    			fs.unlinkSync("/iscsi/" + userId + path + fileName);
	if(fs.existsSync("/iscsi/" + userId + path + fileName) && fs.lstatSync("/iscsi/" + userId + path + fileName).isDirectory())
					deleteFolderRecursive("/iscsi/" + userId + path + fileName);
	response.setHeader('Access-Control-Allow-Origin', '*');
	response.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
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

//TODO upload,download , move, copy
