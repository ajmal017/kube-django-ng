/**
 * @license
 * Copyright 2018 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * =============================================================================
 */

import * as dotenv from 'dotenv';
import { exec } from 'child_process';
import { dialogflow } from './dialogflow';
import { Storage } from '@google-cloud/storage';
import { compare, Options } from "dir-compare";
import * as fs from 'fs';
// const tmp = require('tmp');

dotenv.config();

export class Acceptance {
    private storage: Storage;
    private dev: Object;
    private test: Object;
    private prod: Object;
    private directory: string;
    private bucket: string;
    private previous: string;
   
    constructor() {
        this.dev = {};
        this.test = {};
        this.prod = {};
        this.dev['name'] = 'devAgent';
        this.dev['projectId'] = process.env.DEV_AGENT_PROJECT_ID;
        this.dev['webhook'] = 'http://devurl';
        this.test['name'] = 'testAgent';
        this.test['projectId'] = process.env.TEST_AGENT_PROJECT_ID;
        this.test['webhook'] = 'http://testurl';
        this.prod['name'] = 'prodAgent';
        this.prod['projectId'] = process.env.GCLOUD_PROJECT;
        this.prod['webhook'] = 'http://produrl';
        this.directory = 'tmp/';
        this.bucket = process.env.GCLOUD_STORAGE_BUCKET_NAME;
        this.previous = '';

        this.storage = new Storage();
        this._setupBucket();
    }

    public deployDevToTest() {
        this._deployAgentToAgent(this.dev, this.test);
    }
    public deployTestToProduction() {
        this._deployAgentToAgent(this.test, this.prod);
    }
    public rollback(){
        this._deployAgentToAgent(this.previous, this.prod);
    }

    public runDiff(cb: Function){
        this._runDiff(this.dev, this.test).then((changes)=> {
            cb(changes);
        });
    }

    private async _setupBucket() {
        let me = this;
        this.storage.bucket(this.bucket).exists().then(function(data) {
            const exists = data[0];
            if (exists === false) {
                me.storage.createBucket(me.bucket).then(() => {
                    console.log(`Bucket ${me.bucket} is created.`);
                });
            }   
          });
    }
    
    private async _deployAgentToAgent(from: Object, to: Object) {
        // download devAgent files
        await this._exportAgent(from);
        // download testAgent files
        await this._exportAgent(to);

        // run a diff
        this._runDiff(from, to).then(changes => {
            this._makeZip(changes).then((path) => {
                this._importAgent(path, to);
            });
        });
    }

    private async _runDiff(from, to) {
        let path1 = `${this.directory}${from['name']}`;
        let path2 = `${this.directory}${to['name']}`;
        let options: Partial<Options> = {
            compareSize: true,
            compareContent: true,
            excludeFilter: 'agent.json,package.json' 
        };
        
        return compare(path1, path2, options).then(res => {
            let changes = [], i = 0;
            for (i; i < res.diffSet.length; i++) {
                if (res.diffSet[i].state !== 'equal' && 
                    res.diffSet[i].state !== 'distinct')
                {
                    changes.push(res.diffSet[i]);
                }
            }
            return changes;
        })
    }

    private async _makeZip(changeList: Array<Object>): Promise<any> {
        let i = 0;
        let folder = `${this.directory}prepare`;
        
        return new Promise((resolve, reject) => {
            console.log('Create a temp folder.');
            exec(`rm -rf ${folder} && mkdir ${folder} && mkdir ${folder}/entities && mkdir ${folder}/intents`, (err) => {
                if (err) reject(err);
                else resolve();
            });
        }).then(() => {
            return new Promise((resolve, reject) => {
                console.log(`Copy new files to ${folder}`);
                for (i; i < changeList.length; i++) {
                    if (changeList[i]['path1']) {
                        if (changeList[i]['name1'] !== '.DS_Store') {
                            let name = changeList[i]['name1'].replace(/ /g,"\\ ");
                            console.log(name);
                            console.log(`./${changeList[i]['path1']}/${name}`);
                            exec(`cp ./${changeList[i]['path1']}/${name} ${folder}${changeList[i]['relativePath']} && cp ./tmp/testAgent/agent.json ${folder}`, (err) => {
                                if (err) reject(err);
                                else resolve();
                            });
                        }
                    } else {
                        // TODO intent will need to be removed.
                        // dialogflow.removeIntent();
                    }
                }
            });
        }).then(() => {
            return new Promise((resolve, reject) => {
                console.log(`Zipping newAgent.zip`);
                exec(`cd ${folder}; zip -r newAgent.zip *`, (err) => {
                    if (err) reject(err);
                    else resolve(`${folder}/newAgent.zip`);
                });
            });
        }).catch(err => {
            console.error(err);
        });
    }

    private _importAgent(zipPath: string, to: Object) {
        return new Promise((resolve, reject) => {
            console.log(`Reading ${zipPath}`);
            fs.readFile((zipPath), (err, data) => {
              if (err) reject(err);
              else resolve(data);
            });
        }).then(data => {
          console.log('Restoring to project ' + to['projectId']);
          return dialogflow.importAgent({
            parent: 'projects/' + to['projectId'],
            agentContent: (data as Buffer).toString('base64')
          });
        }).then(([operation]) => {
          // Operation#promise starts polling for the completion 
          // of the Long Running Operation:
          return operation.promise();
        }).catch(err => {
          console.error(err);
        });
    }

    private async _exportAgent(from: Object) {
        let dateObj = new Date(),
            month = dateObj.getUTCMonth() + 1,
            day = dateObj.getUTCDate(),
            year = dateObj.getUTCFullYear(),
            fileName = `${from['name']}-${year}-${month}-${day}.zip`;
        
        return dialogflow.exportAgent(from['projectId'], `gs://${this.bucket}/${fileName}`)
          .then(responses => {
            const [operation] = responses;
            // Operation#promise starts polling for the completion of the LRO.
            console.log(`Export ${fileName} to ${this.bucket}.`);
            return operation.promise();
          })
          .then(() => {
                const options = {
                    // The path to which the file should be downloaded, e.g. "./file.txt"
                    destination: `${this.directory}${fileName}`,
                };
                console.log(`Download ${fileName} to ${options.destination}.`);
                return this.storage.bucket(this.bucket).file(`${fileName}`)
                    .download(options);
          })
          .then(() => {
            console.log(`Unzipping to ${this.directory}${from['name']}`);
            return new Promise((resolve, reject) => {
                exec(`rm -rf ${this.directory}${from['name']} && unzip -o ${this.directory}${fileName} -d ${this.directory}${from['name']}`, (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
          })
          .catch(err => {
            console.error(err);
          });
    }
}

export let acceptance = new Acceptance();