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
import { Component, Injectable, OnInit } from '@angular/core';
import { Observable, of } from 'rxjs';
import { DataSource } from '@angular/cdk/collections';
import { FormGroup, FormControl, Validators } from '@angular/forms';
import * as io from 'socket.io-client';

@Component({
  selector: 'app-test',
  templateUrl: './admin-test.component.html',
  styleUrls: ['./admin-test.component.scss']
})

@Injectable()
export class AdminTestComponent implements OnInit {
  public server: any;
  public form: FormGroup;

  public connectionDifferences;
  public connectionUserPhrases;
  public connectionTestResults;
  public loggedIn;

  public testIntents: string[];
  public testLanguages: string[];

  public userphrases: string[];
  public diffCols: string[] = ['name', 'status', 'action'];
  

  public changes: DiffDataSource;
  public testData: any[];

  constructor() { }

  ngOnInit() {
    const me = this;
    me.testData = new Array();

    // only in localhost
    let server = location.protocol+'//'+location.hostname;
    if (location.hostname === 'localhost' && location.port === '4200'
  || location.hostname === 'localhost' && location.port === '4000'){
      server = location.protocol +  '//'+ location.hostname + ':3000'
    } else {
      // server = location.protocol+'//'+location.hostname+ '/socket.io';
    }


    this.loggedIn = false;
    this.server = io(server);
 
    this.server.on('loadUserPhrases', function(data) {
      this.userphrases = data;
    });
    this.server.on('loadIntents', function(data) {
      me.testIntents = data[0];
    });
    this.server.on('loadSupportedLanguages', function(data) {
      me.testLanguages = data;
    });
    this.server.on('testResultOutput', function(data) {
      me.testData.push(data);
      console.log(me.testData);
    });

    // When we receive a system error, display it
    this.server.on('systemerror', function(error) {
        console.log(error.type + ' - ' + error.message);
    });

    this.connectionDifferences = this.updateRunDiff().subscribe(changes => {
      this.changes = new DiffDataSource(changes);
    });

    this.connectionUserPhrases = this.updateUserPhrases().subscribe(phrases => {
      this.userphrases = phrases;
    });

    this.form = new FormGroup({
      testQuery: new FormControl('',[Validators.required]),
      lang: new FormControl('',[Validators.required]),
      intent: new FormControl('',[Validators.required])
    });

    if(localStorage.getItem("user")) {
      this.loggedIn = true;
    }
  }


  /* LISTENERS */

  onClickDeployDevtoTest() {
    this.server.emit('acceptanceInput', 'deployDevToTest');
  }
  onClickDeployTestoProd() {
    this.server.emit('acceptanceInput', 'deployTestToProduction');
  }
  onClickRollback() {
    this.server.emit('acceptanceInput', 'rollback');
  }
  onClickRollbackDev() {
    this.server.emit('acceptanceInput', 'rollbackDev');
  }
  onClickRunDiff() {
    this.server.emit('acceptanceInput', 'runDiff');
  }
  onClickLoadUserPhrases(e, item) {
    this.server.emit('acceptanceInput', 'loadUserPhrases', item);
  }
  onClickRunTestCases(e) {
    this.server.emit('acceptanceInput', 'runTestCases');
  }


  /* UPDATE METHODS */

  updateRunDiff() {
      this.server.emit('acceptanceInput', 'loadUserPhrases', null);
      const observable = new Observable<any>(observer => {
        // When we receive a customer message, display it
        this.server.on('acceptanceOutput', function(values) {
          let items = [];
          for (var key in values.items) {
            if (!values.items.hasOwnProperty(key)) continue;
            items.push(values.items[key])
          }
          observer.next(items);
        });

        return () => {
          this.server.disconnect();
        };
      });
      return observable;
  }

  updateUserPhrases() {
    const observable = new Observable<any>(observer => {
      // When we receive a customer message, display it
      this.server.on('loadUserPhrases', function(values) {
        observer.next(values);
      });

      return () => {
        this.server.disconnect();
      };
    });
    return observable;
  }

  updateTestCases() {
    console.log('TODO Result All Test Cases');
  }

  addTestCase() {
    const f = this.form;
    let row: TestResultData = {
      TEST_DATE: (new Date().getTime()/1000),
      TEST_LANGUAGE: f.get('lang').value,
      TEST_QUERY: f.get('testQuery').value,
      EXPECTED_INTENT: f.get('intent').value
    };
  
    // submit the row to the back-end
    // run unit test and store results in BQ
    this.server.emit('acceptanceInput', 'addTestCase', row);
  }
}

/* MODELS */

export interface ChangeData {
  name: string;
  size: number;
  status: string;
}

export interface TestResultData { 
  TEST_DATE: number
  TEST_LANGUAGE: string,
  TEST_QUERY: string,
  EXPECTED_INTENT: string,
  DETECTED_INTENT?: string,
  IS_FALLBACK?: boolean,
  TEST_RESULT?: string 
} 

export class DiffDataSource extends DataSource<any> {
  constructor(private data: ChangeData[]) {
    super();
  }
   /** Connect function called by the table to retrieve one stream containing the data to render. */
  connect(): Observable<ChangeData[]> {
    return of(this.data);
  }

  disconnect() {}
}
