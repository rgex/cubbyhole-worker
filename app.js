var fs = require('fs');
var net = require('http');
var express = require("express");
var bodyParser = require('body-parser');
var multipart = require('multipart');
var httpsync = require('httpsync');
var pathHelper = require('path');
var urlHelper = require('url');
var async = require('async');
var querystring = require('querystring');

try {
    var workerJSON = fs.readFileSync("worker.config", "utf8")
    var workerConfig = JSON.parse(workerJSON);
    console.log(workerConfig.webservicePath);
    webserviceHost = workerConfig.webserviceHost;
    webservicePort = workerConfig.webservicePort;
    webservicePath = workerConfig.webservicePath;
}
catch (err){
    console.log("something went wrong with the config.json file. Is this file existing?");
    console.log(err);
    process.abort();
}

var getUserInformationsWithToken = function(token) {

    var post_data = querystring.stringify({
        'token' : token
    });

    var req = httpsync.request({
        url: "http://" + webserviceHost + webservicePath + "?action=getUserIdWithToken",
        method: "POST"
    });
    req.write(post_data);
    var resJson = req.end();
    return JSON.parse(resJson['data']);
}

var handleDownload = function(req, res) {
    console.log("download with token");
    var urlParts = urlHelper.parse(req.url, true);
    var lastChunckSize = null;
    var lastChunckTimeStamp = null;

    console.log(urlParts);
    var downloadSpeed = 100000; //default download speed if user isn't logged in is equal to 100kB/S
    if(typeof urlParts.query.token !== 'undefined') {
        var userInfos = getUserInformationsWithToken(urlParts.query.token);
        downloadSpeed = userInfos['downloadSpeed'];
    }
    var filePath = '/iscsi/' + urlParts.query.userid + urlParts.query.file;
    var fileStat = fs.lstatSync(filePath);
    res.writeHead(200, { 'Content-Type': 'application/force-download', 'Content-Length': fileStat.size, 'Content-disposition' : 'attachment; filename=' + pathHelper.basename(filePath) });
    var readStream = fs.createReadStream(filePath, { bufferSize: 64 * 1024 });
    readStream.on("data", function(data) {
        readStream.pause();
        if(typeof lastChunckSize !== null && typeof lastChunckTimeStamp !== null) {
            var sleepTime = calculatePause(downloadSpeed, lastChunckSize, new Date().getTime() - lastChunckTimeStamp); //wanted speed 100kB = 100000 B
        }
        else {
            var sleepTime = 0;
        }
        setTimeout(function() {
            res.write(data);
            console.log('now download will start flowing again');
            readStream.resume();
        }, sleepTime);
        lastChunckSize      = data.length;
        lastChunckTimeStamp = new Date().getTime();
    });

    readStream.on("end", function() {
        console.log("download done");
        setTimeout(function() {
            res.end("");
        }, 500);
    });

    req.on("end", function() {
        console.log("download stopped");
    });
}

var handleUpload = function(fReq, fRes) {
    var req = fReq;
    var res = fRes;
    req.uploadSpeed = 100000;
    req.lastChunckSize      = null;
    req.lastChunckTimeStamp = null;
    req.nbrOfWritenBytes    = 0;
    var fileInfoChunk = null;
    var fileNameRegex = null;

    req.reqIdentifier = Math.random();

    res.writeHead(200,{"Content-Type": "text/plain",
        "Access-Control-Allow-Origin":"*"
    });

    req.firstChunk = true;

    req.on('data', function (chunk) {
        //if data is empty then we need to extract the headers from it
        if(req.firstChunk) {
            var i = 0;
            var done = false;
            var contentTypeFound = false;
            var postData = new Array();
            req.firstChunk = false;
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
            var userInfos = getUserInformationsWithToken(token);
            req.userId = userInfos['id'];
            req.uploadSpeed = userInfos['uploadSpeed']; // Bytes/S

            if(fs.existsSync("/iscsi/" + req.userId + path + fileName) && fs.lstatSync("/iscsi/" + req.userId + path + fileName).isFile())
                fs.unlinkSync("/iscsi/" + req.userId + path + fileName);
            req.fd = fs.openSync("/iscsi/" + req.userId + path + fileName,'a');
            req.nbrOfWritenBytes = fs.writeSync(req.fd, chunk.slice(i+3,chunk.length), 0, (chunk.length - (i+3)), 0);
            console.log("state 1");
	        console.log("req.reqIdentifier = " + req.reqIdentifier);
        }
        else {
            console.log("state 2");
	        console.log("req.reqIdentifier = " + req.reqIdentifier);
            req.nbrOfWritenBytes += fs.writeSync(req.fd, chunk, 0, chunk.length, req.nbrOfWritenBytes);
            req.pause();
            if(typeof req.lastChunckSize !== null && typeof req.lastChunckTimeStamp !== null) {
                var sleepTime = calculatePause(req.uploadSpeed, req.lastChunckSize, new Date().getTime() - req.lastChunckTimeStamp); //wanted speed 100kB = 100000 B
            }
            else {
                var sleepTime = 0;
            }
            setTimeout(function() {
                console.log('now upload will start flowing again');
                req.resume();
            }, sleepTime);
        }
        req.lastChunckSize      = chunk.length;
        req.lastChunckTimeStamp = new Date().getTime();
    });

    req.on('end', function () {
        //fs.close(fd);
        setTimeout(function() {
            console.log("ended");
            res.end("");
        },500);
    });
}
/***
 * Calculate to wait between 2 chucks to reach a certain download speed.
 *
 * @param wantedSpeed in bytes/second
 * @param chunckSize in bytes
 * @param timeTaken in miliseconds
 */
var calculatePause = function(wantedSpeed, chunckSize, timeTaken) {
    var expectedTimeTaken = Math.floor((chunckSize / (wantedSpeed + wantedSpeed*0.1)) * 1000);
    if(expectedTimeTaken) {
        return expectedTimeTaken;
    }
    else {
        return 0;
    }
}


/***
 *  création du socket pour l'upload
 *
 ***/

var handleHttpReq = function (req, res) {
console.log("got req :");
	if (req.url === '/upload' /*&& req.method === 'POST'*/) {
        setTimeout(function() {
            handleUpload(req, res);
        },1);
	}

	DownloadWTokenRegex = new RegExp('^.{0,}download/\\?userid=(.{1,})&file=(.{1,})&token=(.{1,})$','i'); //not very secured
	if(DownloadWTokenRegex.test(req.url)) { //download with token
        handleDownload(req, res);
	}

}

net.createServer(handleHttpReq).listen(9999, function(){
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

    var userInfos = getUserInformationsWithToken(req.body.token);
    if(typeof userInfos['id'] === 'undefined')
        response.end(''); //error
    var userId = userInfos['id'];
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

    var userInfos = getUserInformationsWithToken(req.body.token);
    if(typeof userInfos['id'] === 'undefined')
        response.end(''); //error
    var userId = userInfos['id'];
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
 *	make a file or a folder become public
 *	@require
 *	- path
 *	- fileName
 *	- token
 *
 ***/
app.post('/makePublic', function(req, response){

    var userInfos = getUserInformationsWithToken(req.body.token);
    if(typeof userInfos['id'] === 'undefined')
        response.end(''); //error
    var userId = userInfos['id'];
    var path = req.body.path;
    if(req.body.path.length === 0)
        path = '/';
    var fileName = req.body.fileName;
    if(fs.existsSync("/iscsi/" + userId + path + fileName)) {
        if(fs.existsSync("/iscsi/" + userId + path + ".publicFiles.json")) {
            var publicFilesJson = fs.readFileSync("/iscsi/" + userId + path + ".publicFiles.json", "utf8");
            var publicFiles = JSON.parse(publicFilesJson);
            var found = false;
            for(var i in publicFiles) {
                if(publicFiles[i] === fileName)
                    found = true;
            }
            if(!found)
                publicFiles.push(fileName);
            fs.unlinkSync("/iscsi/" + userId + path + ".publicFiles.json");
        }
        else {
            var publicFiles = new Array();
            publicFiles.push(fileName);
        }
        fs.writeFileSync("/iscsi/" + userId + path + ".publicFiles.json", JSON.stringify(publicFiles));
    }
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
    response.end('{"result":"success"}');
});


/***
 *
 *	make a file or a folder become private
 *	@require
 *	- path
 *	- fileName
 *	- token
 *
 ***/
app.post('/makePrivate', function(req, response){

    var userInfos = getUserInformationsWithToken(req.body.token);
    if(typeof userInfos['id'] === 'undefined')
        response.end(''); //error
    var userId = userInfos['id'];
    var path = req.body.path;
    if(req.body.path.length === 0)
        path = '/';
    var fileName = req.body.fileName;
    if(fs.existsSync("/iscsi/" + userId + path + fileName)) {
        if(fs.existsSync("/iscsi/" + userId + path + ".publicFiles.json")) {
            var publicFilesJson = fs.readFileSync("/iscsi/" + userId + path + ".publicFiles.json", "utf8");
            var publicFiles = JSON.parse(publicFilesJson);
            var found = false;
            for(var i in publicFiles) {
                if(publicFiles[i] === fileName){
                    publicFiles.splice(i,1);
                    continue;
                }
            }
            fs.unlinkSync("/iscsi/" + userId + path + ".publicFiles.json");
        }
        fs.writeFileSync("/iscsi/" + userId + path + ".publicFiles.json", JSON.stringify(publicFiles));
    }
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

   console.log("getUserInformationsWithToken : ");
   console.log(getUserInformationsWithToken(req.body.token));
   var userInfos = new Array();
   if(typeof req.body.token !== 'undefined')
        userInfos = getUserInformationsWithToken(req.body.token);
   var showPrivate = false;
   if(typeof userInfos['id'] !== 'undefined') {
       var userId = userInfos['id'];
       showPrivate = true
   }
   else {
       var userId = req.body.userId;
       showPrivate = false;
   }
   var path = '/';

   if(typeof req.body !== 'undefined'
      && typeof req.body.path !== 'undefined'
      && req.body.path !== '')
	path = req.body.path;
   var path = '/iscsi/' + userId + path;

    var publicFiles = new Array();
    if(fs.existsSync(path + ".publicFiles.json")) {
       var publicFilesJson = fs.readFileSync(path + ".publicFiles.json", "utf8");
       var publicFiles = JSON.parse(publicFilesJson);
    }
    var readdir = fs.readdirSync(path);
    var jsonResponse = new Array();
    for(var i in readdir)
    {
        var publicStatus = "priv";
        for(var z in publicFiles) {
            if(publicFiles[z] === readdir[i])
                publicStatus = "pub";
        }

        if(readdir[i] !== ".publicFiles.json") {
            if(fs.lstatSync(path + readdir[i]).isDirectory()) {
                if(publicStatus === "pub" || showPrivate)
                    jsonResponse.push(new Array('D',readdir[i],'0',publicStatus));
            }
            else {
                var fileStats = fs.statSync(path + readdir[i]);
                var fileSize  = fileStats['size']; // in bytes
                if(publicStatus === "pub" || showPrivate)
                    jsonResponse.push(new Array('F',readdir[i],fileSize,publicStatus));
            }
        }
    }

   response.setHeader('Access-Control-Allow-Origin', '*');
   response.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
   response.end(JSON.stringify(jsonResponse).toString('utf8'));
   
});