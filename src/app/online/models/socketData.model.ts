import { IPick } from '@world/models/pick.model';

export interface ISocketDataRoomJoined {
  me: string;
  usersConnected: string[];
  objectsAdded: IPick[];
  objectsRemoved: THREE.Object3D[];
  startTime: number;
}

export interface ISocketDataPositionUpdated {
  userID: string;
  position: THREE.Vector3;
}

export interface ISocketDataObjectAdded {
  item: IPick;
}

export interface ISocketDataObjectRemoved {
  object: THREE.Object3D;
}

export interface ISocketDataObjectsInitialized {
  placedObjects: IPick[];
}

export interface ISocketDataDisconnection {
  userID: string;
}
