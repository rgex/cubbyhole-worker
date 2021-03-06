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
var execSync = require('exec-sync');

try {
    var workerJSON = fs.readFileSync("/var/cubbyhole-worker/worker.config", "utf8")
    var workerConfig = JSON.parse(workerJSON);
    console.log(workerConfig.webservicePath);
    webserviceHost      = workerConfig.webserviceHost;
    webservicePath      = workerConfig.webservicePath;
    storageFolder       = workerConfig.storageFolder;
    masterKey           = workerConfig.masterKey;
    WsPort              = workerConfig.WsPort;
    DataTransferPort    = workerConfig.DataTransferPort;

    if(typeof workerConfig.newRelicToken !== 'undefined')
        newRelicToken = workerConfig.newRelicToken;
    else
        newRelicToken = null;
}
catch (err){
    console.log("something went wrong with the worker.json file. Is this file existing?");
    console.log(err);
    process.abort();
}

var getUserInformationsWithToken = function(token) {

    var post_data = querystring.stringify({
        'token' : token
    });

    var req = httpsync.request({
        url: "http://" + webserviceHost + webservicePath + "getUserWithToken/",
        method: "POST"
    });
    req.write(post_data);
    var resJson = req.end();
    return JSON.parse(resJson['data']);
}

var updateUserStats = function(token,added,removed,addedFiles,removedFiles) {

     var post_data = querystring.stringify({
        'token' 	    : token,
	    'added' 	    : added,
	    'removed' 	    : removed,
	    'addedFiles' 	: addedFiles,
	    'removedFiles' 	: removedFiles
    });

    var req = httpsync.request({
        url: "http://" + webserviceHost + webservicePath + "updateDiskSpace/",
        method: "POST"
    });
    req.write(post_data);
    var res = req.end();
    console.log("UPDATE USERSTATS RES : ");
    console.log(res['data'].toString());
}

var handleDownload = function(req, res) {
    console.log("download with token");
    var urlParts = urlHelper.parse(req.url, true);
    var lastChunckSize      = null;
    var lastChunckTimeStamp = null;
    var sleepTime           = 0;
    console.log(urlParts);

    //sanitize urlParts.query.path
    var regex = /^\.\.\/.{0,}$/;
    if(urlParts.query.path.match(regex) || urlParts.query.file.match(regex)) {
        res.end('this is forbidden #1');
        return;
    }
    regex = /^.{0,}\/\.\.\/.{0,}$/;
    if(urlParts.query.path.match(regex) || urlParts.query.file.match(regex)) {
        res.end('this is forbidden #2');
        return;
    }
    regex = /^\.\/.{0,}/;
    if(urlParts.query.path.match(regex) || urlParts.query.file.match(regex)) {
        res.end('this is forbidden #3');
        return;
    }
    regex = /.{0,}\/\.\/.{0,}/;
    if(urlParts.query.path.match(regex) || urlParts.query.file.match(regex)) {
        res.end('this is forbidden #4');
        return;
    }

    var downloadSpeed = 100000; //default download speed if user isn't logged in is equal to 100kB/S
                                // @TODO add this in config file

    var userId = null;
    if(typeof urlParts.query.token !== 'undefined') {
        var userInfos = getUserInformationsWithToken(urlParts.query.token);
        userId        = userInfos['id'];
        downloadSpeed = userInfos['downloadSpeed'];
    }

    if(userId !== urlParts.query.userid) {
        //if user is not downloading a file he owns whe check if has the right to download it.
        console.log("preparing to download file from an other user.");
        var publicFiles = new Array();
        if(fs.existsSync(storageFolder + urlParts.query.userid + urlParts.query.path + ".publicFiles.json")) {
            var publicFilesJson = fs.readFileSync(storageFolder + urlParts.query.userid + urlParts.query.path + ".publicFiles.json", "utf8");
            publicFiles = JSON.parse(publicFilesJson);
        }

        var isPublic = false;

        for(var z in publicFiles) {
            if(publicFiles[z] === urlParts.query.file)
                  isPublic = true;
        }

        if(!isPublic) {
            res.end("You are not allowed to download this file.");
            return;
        }
    }
    var filePath = storageFolder + urlParts.query.userid + urlParts.query.path + urlParts.query.file;
    var fileStat = fs.lstatSync(filePath);
    res.writeHead(200, { 'Content-Type': 'application/force-download', 'Content-Length': fileStat.size, 'Content-disposition' : 'attachment; filename=' + pathHelper.basename(filePath) });
    var readStream = fs.createReadStream(filePath, { bufferSize: 64 * 1024 });
    readStream.on("data", function(data) {
        readStream.pause();
        if(typeof lastChunckSize !== null && typeof lastChunckTimeStamp !== null) {
            sleepTime = calculatePause(downloadSpeed, lastChunckSize, new Date().getTime() - lastChunckTimeStamp); //wanted speed 100kB = 100000 B
        }
        else {
            sleepTime = 0;
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

var cleanUploadedFile = function (path,fileName){
    // @TODO sanitize bottom of the file
}

var handleUpload = function(fReq, fRes) {
    var req = fReq;
    var res = fRes;
    req.uploadSpeed = 100000;
    req.lastChunckSize      = null;
    req.lastChunckTimeStamp = null;
    req.nbrOfWritenBytes    = 0;
    req.nbrOfWritenBytes2   = 0;
    req.userToken     = '';
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
            //console.log(chunk.toString());
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

            req.userToken  = postData[0];
            var path = postData[1];

            updateUserStats(req.userToken,0,0,1,0);
            console.log("token : " + req.userToken );
            console.log("path : " + path);
            console.log("fileName : " + fileName);

            var userInfos = getUserInformationsWithToken(req.userToken );
            req.userId = userInfos['id'];
            req.uploadSpeed = userInfos['uploadSpeed']; // Bytes/S

            if(fs.existsSync(storageFolder + req.userId + path + fileName) && fs.lstatSync(storageFolder + req.userId + path + fileName).isFile())
                fs.unlinkSync(storageFolder + req.userId + path + fileName);
            req.fd = fs.openSync(storageFolder + req.userId + path + fileName,'a');
            req.nbrOfWritenBytes = fs.writeSync(req.fd, chunk.slice(i+3,chunk.length), 0, (chunk.length - (i+3)), 0);
            req.nbrOfWritenBytes2 = req.nbrOfWritenBytes;
            console.log("state 1");
	        console.log("req.reqIdentifier = " + req.reqIdentifier);
        }
        else {
            console.log("state 2");
	        console.log("req.reqIdentifier = " + req.reqIdentifier);
            var writenBytes = fs.writeSync(req.fd, chunk, 0, chunk.length, req.nbrOfWritenBytes);
            req.nbrOfWritenBytes += writenBytes;
            req.nbrOfWritenBytes2 += writenBytes;
            req.pause();

            var sleepTime = 0;
            if(typeof req.lastChunckSize !== null && typeof req.lastChunckTimeStamp !== null) {
                sleepTime = calculatePause(req.uploadSpeed, req.lastChunckSize, new Date().getTime() - req.lastChunckTimeStamp); //wanted speed 100kB = 100000 B
            }
            setTimeout(function() {
                console.log('now upload will start flowing again');
                req.resume();
            }, sleepTime);
        }
        req.lastChunckSize      = chunk.length;
        req.lastChunckTimeStamp = new Date().getTime();
        if(req.nbrOfWritenBytes2 > 10000000) //bigger than 10MB
        {
            updateUserStats(req.userToken ,req.nbrOfWritenBytes2,0,0,0);
            req.nbrOfWritenBytes2 = 0;
        }
    });

    req.on('end', function () {
        //fs.close(fd);
        setTimeout(function() {
            console.log("ended");
	    updateUserStats(req.userToken ,req.nbrOfWritenBytes2,0,0,0);
            req.nbrOfWritenBytes2 = 0;
            res.end("");
        },500);
    });
}

/***
 * Calculate time to wait between 2 chucks to reach a certain download speed.
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
 *  Download and upload socket
 *
 ***/

var handleHttpReq = function (req, res) {
console.log("got req :");
	if (req.url === '/upload') {
        setTimeout(function() {
            handleUpload(req, res);
        },1);
	}

	var DownloadRegex = new RegExp('^.{0,}download/.{0,}$','i'); //not very secured
	if(DownloadRegex.test(req.url)) { //download with token
        handleDownload(req, res);
	}

}

net.createServer(handleHttpReq).listen(DataTransferPort, function(){
        console.log('TRANSFER SERVER Listening at port : ' + DataTransferPort);
});



/***
 *  starting webserver for WebService
 *  delete, rename, list files ...
 *
 ***/
var app = express();
app.listen(WsPort, function(){
        console.log('WEBSERVICE SERVER Listening at port : ' + WsPort);
});
app.use(bodyParser.urlencoded({
  extended: true
}));


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

	if(req.body.masterKey === masterKey) {
	   	var userId = req.body.userId;
		fs.mkdirSync(storageFolder + userId,0777);
		response.setHeader('Access-Control-Allow-Origin', '*');
		response.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
		response.end('{"result":"success"}');
	}
	else {
		response.setHeader('Access-Control-Allow-Origin', '*');
		response.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
		response.end('{"result":"error, wrong masterkey"}');
	}
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
	fs.mkdirSync(storageFolder + userId + req.body.path + req.body.folderName,0777);
	response.setHeader('Access-Control-Allow-Origin', '*');
	response.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
	response.end('{"result":"success"}');
});

var deleteFolderRecursive = function(token,path) {
    var numberOfDeletedFiles = 0;
    var deletedSpace = 0;
    if( fs.existsSync(path) ) {
        fs.readdirSync(path).forEach(function(file,index){
          var curPath = path + "/" + file;
          if(fs.lstatSync(curPath).isDirectory()) { // recurse
              deleteFolderRecursive(curPath);
          } else { // delete file
              var fileStats = fs.statSync(curPath);
              var fileSize  = fileStats['size']; // in bytes
              fs.unlinkSync(curPath);
              numberOfDeletedFiles++;
              deletedSpace += fileSize;
          }
        });
        fs.rmdirSync(path);
    }
    updateUserStats(token,0,deletedSpace,0,numberOfDeletedFiles);
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

    	var fileStats = fs.statSync(storageFolder + userId + path + fileName);
    	var fileSize  = fileStats['size']; // in bytes

	if(fs.existsSync(storageFolder + userId + path + fileName) && fs.lstatSync(storageFolder + userId + path + fileName).isFile())
		    			fs.unlinkSync(storageFolder + userId + path + fileName);
	if(fs.existsSync(storageFolder + userId + path + fileName) && fs.lstatSync(storageFolder + userId + path + fileName).isDirectory())
					deleteFolderRecursive(req.body.token,storageFolder + userId + path + fileName);

    updateUserStats(req.body.token,0,fileSize,0,1);

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
app.post('/makePublic', function(req, response) {

    var publicFiles;
    var userInfos = getUserInformationsWithToken(req.body.token);
    if(typeof userInfos['id'] === 'undefined')
        response.end(''); //error
    var userId = userInfos['id'];
    var path = req.body.path;
    if(req.body.path.length === 0)
        path = '/';
    var fileName = req.body.fileName;
    if(fs.existsSync(storageFolder + userId + path + fileName)) {
        if(fs.existsSync(storageFolder + userId + path + ".publicFiles.json")) {
            var publicFilesJson = fs.readFileSync(storageFolder + userId + path + ".publicFiles.json", "utf8");
            publicFiles = JSON.parse(publicFilesJson);
            var found = false;
            for(var i in publicFiles) {
                if(publicFiles[i] === fileName)
                    found = true;
            }
            if(!found)
                publicFiles.push(fileName);
            fs.unlinkSync(storageFolder + userId + path + ".publicFiles.json");
        }
        else {
            publicFiles = new Array();
            publicFiles.push(fileName);
        }
        fs.writeFileSync(storageFolder + userId + path + ".publicFiles.json", JSON.stringify(publicFiles));
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
    if(fs.existsSync(storageFolder + userId + path + fileName)) {
        if(fs.existsSync(storageFolder + userId + path + ".publicFiles.json")) {
            var publicFilesJson = fs.readFileSync(storageFolder + userId + path + ".publicFiles.json", "utf8");
            var publicFiles = JSON.parse(publicFilesJson);
            var found = false;
            for(var i in publicFiles) {
                if(publicFiles[i] === fileName){
                    publicFiles.splice(i,1);
                    continue;
                }
            }
            fs.unlinkSync(storageFolder + userId + path + ".publicFiles.json");
        }
        fs.writeFileSync(storageFolder + userId + path + ".publicFiles.json", JSON.stringify(publicFiles));
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
*	- or userId
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
       showPrivate = true;
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
   var path = storageFolder + userId + path;

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

var listAll = function (userId, path) {
    var showPrivate = true;
    var readdir = fs.readdirSync(storageFolder + userId + path);

    if(fs.existsSync(storageFolder + userId + path + ".publicFiles.json")) {
        var publicFilesJson = fs.readFileSync(storageFolder + userId + path + ".publicFiles.json", "utf8");
        var publicFiles = JSON.parse(publicFilesJson);
    }

    var res = new Array();

    for(var i in readdir)
    {
        var publicStatus = "priv";
        for(var z in publicFiles) {
            if(publicFiles[z] === readdir[i])
                publicStatus = "pub";
        }

        if(readdir[i] !== ".publicFiles.json") {
            if(fs.lstatSync(storageFolder + userId + path + readdir[i]).isDirectory()) {
                if(publicStatus === "pub" || showPrivate)
                    res.push(new Array('D',
                        path + readdir[i],
                        '0',
                        publicStatus,
                        Math.round(fs.lstatSync(storageFolder + userId + path + readdir[i]).mtime.getTime())/1000));
                    var res2 = listAll(userId, path + readdir[i] + '/');
                    res = res.concat(res2);
            }
            else {
                var fileStats = fs.statSync(storageFolder + userId + path + readdir[i]);
                var fileSize  = fileStats['size']; // in bytes
                if(publicStatus === "pub" || showPrivate)
                    res.push(new Array('F',
                        path + readdir[i],
                        fileSize,
                        publicStatus,
                        Math.round(fs.lstatSync(storageFolder + userId + path + readdir[i]).mtime.getTime())/1000));
            }
        }
    }
    return res;
}

/***
 *
 *	get space avaible on the SAN
 *
 ***/
app.get('/getSanSpace', function(req, response){
    var dfIscsi = execSync('df ' + storageFolder);
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
    response.end(dfIscsi);
});

/***
 *
 *	list all files (for syncronisation)
 *	@require
 *	- token
 *
 ***/
app.post('/listAll', function(req, response){
    var userInfos = getUserInformationsWithToken(req.body.token);
    if(typeof userInfos['id'] === 'undefined')
        response.end(''); //error
    var userId = userInfos['id'];

    var jsonResponse = listAll(userId, '/');

    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
    response.end(JSON.stringify(jsonResponse).toString('utf8'));
});


/***
 *
 *      get index
 *
 ***/
app.get('/', function(req, response){
    var hostname = execSync('hostname');
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
    response.end(" <b>" +  hostname +" </b> is running!");
});

