// Copyright (c) Microsoft Corporation
// All rights reserved.
//
// MIT License
//
// Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
// documentation files (the "Software"), to deal in the Software without restriction, including without limitation
// the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and
// to permit persons to whom the Software is furnished to do so, subject to the following conditions:
// The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED *AS IS*, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
// BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
// NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

import {FontClassNames, FontWeights, FontSizes} from '@uifabric/styling';
import c from 'classnames';
import {get, isEmpty, isNil} from 'lodash';
import {DateTime} from 'luxon';
import {ActionButton, DefaultButton} from 'office-ui-fabric-react/lib/Button';
import {Dropdown} from 'office-ui-fabric-react/lib/Dropdown';
import {Link} from 'office-ui-fabric-react/lib/Link';
import {MessageBar, MessageBarType} from 'office-ui-fabric-react/lib/MessageBar';
import PropTypes from 'prop-types';
import React from 'react';
import yaml from 'js-yaml';

import t from '../../tachyons.css';

import Card from './card';
import MonacoPanel from './monaco-panel';
import StatusBadge from './status-badge';
import Timer from './timer';
import {getJobMetricsUrl, cloneJob, openJobAttemptsPage} from '../conn';
import {printDateTime, getHumanizedJobStateString, getDurationString} from '../util';

const StoppableStatus = [
  'Running',
  'Waiting',
];

export default class Summary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      monacoProps: null,
      modalTitle: '',
      autoReloadInterval: 10 * 1000,
    };

    this.onChangeInterval = this.onChangeInterval.bind(this);
    this.onDismiss = this.onDismiss.bind(this);
    this.showExitDiagnostics = this.showExitDiagnostics.bind(this);
    this.showEditor = this.showEditor.bind(this);
    this.showJobConfig = this.showJobConfig.bind(this);
  }

  onChangeInterval(e, item) {
    this.setState({autoReloadInterval: item.key});
  }

  onDismiss() {
    this.setState({
      monacoProps: null,
      modalTitle: '',
    });
  }

  showEditor(title, props) {
    this.setState({
      monacoProps: props,
      modalTitle: title,
    });
  }

  showExitDiagnostics() {
    const {jobInfo} = this.props;
    const messages = jobInfo.jobStatus.appExitMessages;
    const result = [];
    if (!isEmpty(messages.container)) {
      result.push('[Container Stderr]');
      result.push('');
      result.push(messages.container);
      result.push('');
    }
    if (!isEmpty(messages.runtime)) {
      result.push('[Runtime Output]');
      result.push('');
      result.push(yaml.safeDump(messages.runtime));
      result.push('');
    }
    if (!isEmpty(messages.launcher)) {
      result.push('[Launcher Output]');
      result.push('');
      result.push(messages.launcher);
      result.push('');
    }

    this.showEditor('Exit Diagnostics', {
      language: 'text',
      value: result.join('\n'),
    });
  }

  showJobConfig() {
    const {jobConfig} = this.props;
    this.showEditor('Job Config', {
      language: 'json',
      value: JSON.stringify(jobConfig, null, 2),
    });
  }

  renderHintMessage() {
    const {jobInfo} = this.props;
    if (!jobInfo) {
      return;
    }

    const HintItem = ({header, value}) => (
      <div className={c(t.flex, t.justifyStart)}>
        <div style={{width: '12rem', fontWeight: FontWeights.semibold}}>
          {header}
        </div>
        <div>{value}</div>
      </div>
    );

    const state = getHumanizedJobStateString(jobInfo);
    if (state === 'Failed') {
      const result = [];
      const spec = get(jobInfo, 'jobStatus.appExitSpec');
      // error type
      const type = spec && spec.type;
      if (type) {
        result.push(<HintItem key='type' header='Error Type:' value={spec.type} />);
      }
      // trigger task
      const role = get(jobInfo, 'jobStatus.appExitTriggerTaskRoleName');
      const idx = get(jobInfo, 'jobStatus.appExitTriggerTaskIndex');
      if (role) {
        result.push(<HintItem key='task-role' header='Task Role:' value={role} />);
      }
      if (role && !isNil(idx)) {
        const containerId = get(jobInfo, `taskRoles.${role}.taskStatuses[${idx}].containerId`);
        if (containerId) {
          result.push(<HintItem key='container-id' header='Container Id:' value={containerId} />);
        }
      }
      // exit code
      const runtimeOutput = get(jobInfo, 'jobStatus.appExitMessages.runtime');
      if (type === 'USER_FAILURE') {
        // user failure
        if (runtimeOutput) {
          const userCode = runtimeOutput.originalUserExitCode;
          if (!isNil(userCode)) {
            result.push(<HintItem key='user-exit-code' header='User Exit Code:' value={userCode} />);
          }
        }
      } else {
        // platform failure
        const code = jobInfo.jobStatus.appExitCode;
        result.push(<HintItem key='platform-exit-code' header='Platform Exit Code:' value={code} />);
      }
      // reason & solution
      const reason = [];
      const solution = [];
      if (runtimeOutput && runtimeOutput.reason) {
        reason.push(
          <div key='runtime-reason'>{runtimeOutput.reason}</div>,
        );
      }
      if (runtimeOutput && runtimeOutput.solution) {
        solution.push(
          <div key='runtime-solution'>{runtimeOutput.solution}</div>,
        );
      }
      if (spec && spec.reason) {
        reason.push(
          <div key='spec-reason'>{spec.reason}</div>,
        );
      }
      if (spec && spec.solution) {
        solution.push(
          ...spec.solution.map((x, i) => (
            <div key={`spec-reason-${i}`}>{x}</div>
          )),
        );
      }
      if (!isEmpty(reason)) {
        result.push(<HintItem key='reason' header='Reason:' value={reason} />);
      }
      if (!isEmpty(solution)) {
        result.push(<HintItem key='solution' header='Solution:' value={solution} />);
      }

      return (
        <MessageBar messageBarType={MessageBarType.error}>
          <div>
            {result}
          </div>
        </MessageBar>
      );
    } else if (state === 'Waiting') {
      const resourceRetries = get(jobInfo, 'jobStatus.retryDetails.resource');
      if (resourceRetries >= 3) {
        return (
          <MessageBar messageBarType={MessageBarType.warning}>
            <div>
              <div>
                <span className={c(t.w4, t.dib)} style={{fontWeight: FontWeights.semibold}}>
                  Error Type:
                </span>
                <span className={c(t.ml2)}>
                  Resource Conflicts
                </span>
              </div>
              <div>
                <span className={c(t.w4, t.dib)} style={{fontWeight: FontWeights.semibold}}>
                  Conflict Count:
                </span>
                <span className={c(t.ml2)}>
                  {resourceRetries}
                </span>
              </div>
              <div>
                <span className={c(t.w4, t.dib)} style={{fontWeight: FontWeights.semibold}}>
                  Resolution:
                </span>
                <span className={c(t.ml2)}>
                  Please adjust the resource requirement in your <Link onClick={this.showJobConfig}>job config</Link>, or wait till other jobs release more resources back to the system.
                </span>
              </div>
            </div>
          </MessageBar>
        );
      }
    }
  }

  render() {
    const {autoReloadInterval, modalTitle, monacoProps} = this.state;
    const {className, jobInfo, jobConfig, reloading, onStopJob, onReload} = this.props;
    const hintMessage = this.renderHintMessage();

    return (
      <div className={className}>
        {/* summary */}
        <Card className={c(t.pv4)} style={{paddingLeft: 32, paddingRight: 32}}>
          {/* summary-row-1 */}
          <div className={c(t.flex, t.justifyBetween, t.itemsCenter)}>
            <div
              className={c(t.truncate)}
              style={{
                fontSize: FontSizes.xxLarge,
                fontWeight: FontWeights.regular,
              }}
            >
              {jobInfo.name}
            </div>
            <div className={c(t.flex, t.itemsCenter)}>
              <Dropdown
                styles={{
                  title: [FontClassNames.mediumPlus, {border: 0}],
                }}
                dropdownWidth={180}
                selectedKey={autoReloadInterval}
                onChange={this.onChangeInterval}
                options={[
                  {key: 0, text: 'Disable Auto Refresh'},
                  {key: 10000, text: 'Refresh every 10s'},
                  {key: 30000, text: 'Refresh every 30s'},
                  {key: 60000, text: 'Refresh every 60s'},
                ]}
              />
              <ActionButton
                className={t.ml2}
                styles={{root: [FontClassNames.mediumPlus]}}
                iconProps={{iconName: 'Refresh'}}
                disabled={reloading}
                onClick={onReload}
              >
                Refresh
              </ActionButton>
            </div>
          </div>
          {/* summary-row-2 */}
          <div className={c(t.mt4, t.flex, t.itemsStart)}>
            <div>
              <div className={c(t.gray, FontClassNames.medium)}>Status</div>
              <div className={c(t.mt2)}>
                <StatusBadge status={getHumanizedJobStateString(jobInfo)}/>
              </div>
            </div>
            <div className={t.ml5}>
              <div className={c(t.gray, FontClassNames.medium)}>Start Time</div>
              <div className={c(t.mt2, FontClassNames.mediumPlus)}>
                {printDateTime(DateTime.fromMillis(jobInfo.jobStatus.createdTime))}
              </div>
            </div>
            <div className={t.ml5}>
              <div className={c(t.gray, FontClassNames.medium)}>User</div>
              <div className={c(t.mt2, FontClassNames.mediumPlus)}>
                {jobInfo.jobStatus.username}
              </div>
            </div>
            <div className={t.ml5}>
              <div className={c(t.gray, FontClassNames.medium)}>Virtual Cluster</div>
              <div className={c(t.mt2, FontClassNames.mediumPlus)}>
                {jobInfo.jobStatus.virtualCluster}
              </div>
            </div>
            <div className={t.ml5}>
              <div className={c(t.gray, FontClassNames.medium)}>Duration</div>
              <div className={c(t.mt2, FontClassNames.mediumPlus)}>
                {getDurationString(jobInfo)}
              </div>
            </div>
            <div className={t.ml5}>
              <div className={c(t.gray, FontClassNames.medium)}>Retries</div>
              <Link
                className={c(t.mt2, FontClassNames.mediumPlus)}
                onClick={() => openJobAttemptsPage(jobInfo.jobStatus.retries)}
                disabled={isNil(jobInfo.jobStatus.retries)}
              >
                {jobInfo.jobStatus.retries}
              </Link>
            </div>
          </div>
          {/* summary-row-2.5 error info */}
          {hintMessage && (
            <div className={t.mt4}>
              {hintMessage}
            </div>
          )}
          {/* summary-row-3 */}
          <div className={c(t.mt4, t.flex, t.justifyBetween, t.itemsCenter)}>
            <div className={c(t.flex)}>
              <Link
                styles={{root: [FontClassNames.mediumPlus]}}
                href='#'
                disabled={isNil(jobConfig)}
                onClick={this.showJobConfig}
              >
                View Job Config
              </Link>
              <div className={c(t.bl, t.mh3)}></div>
              <Link
                styles={{root: [FontClassNames.mediumPlus]}}
                href='#'
                disabled={isNil(jobInfo.jobStatus.appExitSpec)}
                onClick={this.showExitDiagnostics}
              >
                View Exit Diagnostics
              </Link>
              <div className={c(t.bl, t.mh3)}></div>
              <Link
                styles={{root: [FontClassNames.mediumPlus]}}
                href={jobInfo.jobStatus.appTrackingUrl}
                target="_blank"
              >
                Go to Application Tracking Page
              </Link>
              <div className={c(t.bl, t.mh3)}></div>
              <Link
                styles={{root: [FontClassNames.mediumPlus]}}
                href={getJobMetricsUrl()}
                target="_blank"
              >
                Go to Job Metrics Page
              </Link>
            </div>
            <div>
              <DefaultButton
                text='Clone'
                onClick={() => cloneJob(jobConfig)}
                disabled={isNil(jobConfig)}
              />
              <DefaultButton
                className={c(t.ml3)}
                text='Stop'
                onClick={onStopJob}
                disabled={!StoppableStatus.includes(getHumanizedJobStateString(jobInfo))}
              />
            </div>
          </div>
          {/* Monaco Editor Modal */}
          <MonacoPanel
            isOpen={!isNil(monacoProps)}
            onDismiss={this.onDismiss}
            title={modalTitle}
            monacoProps={monacoProps}
          />
          {/* Timer */}
          <Timer interval={autoReloadInterval === 0 ? null : autoReloadInterval} func={onReload} />
        </Card>
      </div>
    );
  }
}

Summary.propTypes = {
  className: PropTypes.string,
  jobInfo: PropTypes.object.isRequired,
  jobConfig: PropTypes.object,
  reloading: PropTypes.bool.isRequired,
  onStopJob: PropTypes.func.isRequired,
  onReload: PropTypes.func.isRequired,
};
