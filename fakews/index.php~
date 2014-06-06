<?php

switch($_GET['action']) {
	case 'getUserIdWithToken':
		if(!isset($_POST['token']))
			die(json_encode(array("error" => "invalid token")));
		echo json_encode(array("id" => 1,
		       "downloadSpeed" => 1000,
		       "uploadSpeed" => 1000,
		       "maximalSpace" => 2000000000,
		       "spaceUsed" => 99000000,
			));
	break;

	case 'updateDiskSpace':
		if(isset($_POST['token']) && isset($_POST['added']) && isset($_POST['removed'])
		   && isset($_POST['addedFiles']) && isset($_POST['removedFiles']))
		{
			echo json_encode(array("success" => ""));
		}
		else
		{
			echo json_encode(array("error" => "invalid token"));
		}
	break;

	case 'login':
		if(isset($_POST['login']) && isset($_POST['password']))
		{
			echo json_encode(array("token" => "af45e30fedd2",
		       			       "worker" => "http://192.168.0.1:3000/"));
		}
		else
		{
			echo json_encode(array("error" => "wrong login or password"));
		}
	break;

	case 'logout':
		if(isset($_POST['token']))
		{
			echo json_encode(array("success" => "you are now loged out"));
		}
		else
		{
			echo json_encode(array("error" => "invalid token"));
		}
	break;
}

?>
