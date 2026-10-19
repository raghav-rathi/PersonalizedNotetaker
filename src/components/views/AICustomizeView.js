import { html, css, LitElement } from '../../assets/lit-core-2.7.4.min.js';
import { unifiedPageStyles } from './sharedPageStyles.js';
import { PROFILES } from './profiles.js';

export class AICustomizeView extends LitElement {
    static styles = [
        unifiedPageStyles,
        css`
            .unified-page {
                height: 100%;
            }
            .unified-wrap {
                height: 100%;
            }
            section.surface {
                flex: 1;
                display: flex;
                flex-direction: column;
            }
            .form-grid {
                flex: 1;
                display: flex;
                flex-direction: column;
            }
            .form-group.vertical {
                flex: 1;
                display: flex;
                flex-direction: column;
            }
            textarea.control {
                flex: 1;
                resize: none;
                overflow-y: auto;
                min-height: 0;
            }
        `,
    ];

    static properties = {
        selectedProfile: { type: String },
        onProfileChange: { type: Function },
        _context: { state: true },
        _meetingName: { state: true },
        _meetingContext: { state: true },
        _promptStatus: { state: true },
    };

    constructor() {
        super();
        this.selectedProfile = 'interview';
        this.onProfileChange = () => {};
        this._context = '';
        this._meetingName = 'Bharat';
        this._meetingContext = '';
        this._promptStatus = '';
        this._loadFromStorage();
    }

    async _loadFromStorage() {
        try {
            const prefs = await cheatingDaddy.storage.getPreferences();
            this._context = prefs.customPrompt || '';
            this._meetingName = prefs.meetingName ?? 'Bharat';
            this._meetingContext = prefs.meetingContext || '';
            this.requestUpdate();
        } catch (error) {
            console.error('Error loading AI customize storage:', error);
        }
    }

    _handleProfileChange(e) {
        this.onProfileChange(e.target.value);
    }

    async _saveContext(val) {
        this._context = val;
        await cheatingDaddy.storage.updatePreference('customPrompt', val);
    }

    // The meeting profile keeps its own name and context, so the interview instructions stay untouched.
    async _saveMeeting(key, val) {
        this[key === 'meetingName' ? '_meetingName' : '_meetingContext'] = val;
        await cheatingDaddy.storage.updatePreference(key, val);
    }

    async _openRoundPrompt() {
        const result = await window.require('electron').ipcRenderer.invoke('open-round-prompt', this.selectedProfile);
        this._promptStatus = result.success ? `Opened ${result.path}` : `Could not open the prompt: ${result.error}`;
    }

    render() {
        return html`
            <div class="unified-page">
                <div class="unified-wrap">
                    <div>
                        <div class="page-title">AI Context</div>
                    </div>

                    <section class="surface">
                        <div class="form-grid">
                            <div class="form-group">
                                <label class="form-label">Profile</label>
                                <select class="control" .value=${this.selectedProfile} @change=${this._handleProfileChange}>
                                    ${PROFILES.map(profile => html`<option value=${profile.value} ?selected=${profile.value === this.selectedProfile}>${profile.label}</option>`)}
                                </select>
                            </div>
                            ${
                                ['coding', 'lld', 'hld', 'devops'].includes(this.selectedProfile)
                                    ? html`<div class="form-group">
                                              <label class="form-label">Round Prompt</label>
                                              <button class="control" type="button" @click=${() => this._openRoundPrompt()}>Edit round prompt</button>
                                          </div>
                                          <div class="form-help">
                                              ${
                                                  this._promptStatus ||
                                                  `${
                                                      this.selectedProfile === 'devops'
                                                          ? 'Writes every DevOps answer; the coding hotkeys keep the DSA round prompt.'
                                                          : 'Runs the ⌘⌥1 to ⌘⌥6 steps.'
                                                  } Edits apply from the next reply, no rebuild or restart.`
                                              }
                                          </div>`
                                    : ''
                            }
                            ${
                                this.selectedProfile === 'meeting'
                                    ? html`<div class="form-group">
                                              <label class="form-label">Your name in meetings</label>
                                              <input
                                                  class="control"
                                                  type="text"
                                                  .value=${this._meetingName}
                                                  @input=${e => this._saveMeeting('meetingName', e.target.value)}
                                              />
                                          </div>
                                          <div class="form-group vertical">
                                              <label class="form-label">Meeting context</label>
                                              <textarea
                                                  class="control"
                                                  placeholder="What the meeting is about: tickets, changes, test results, log markers, queries..."
                                                  .value=${this._meetingContext}
                                                  @input=${e => this._saveMeeting('meetingContext', e.target.value)}
                                              ></textarea>
                                              <div class="form-help">
                                                  Answers use only these facts. You can also edit it during the meeting from the Context tab; changes
                                                  apply from the next answer.
                                              </div>
                                          </div>`
                                    : this._renderCustomInstructions()
                            }
                        </div>
                    </section>
                </div>
            </div>
        `;
    }

    _renderCustomInstructions() {
        return html`
            <div class="form-group vertical">
                <label class="form-label">Custom Instructions</label>
                <textarea
                    class="control"
                    placeholder=${
                        this.selectedProfile === 'lld'
                            ? 'Optional: Java or Python, Amazon/Flipkart, any use cases they already sent...'
                            : this.selectedProfile === 'devops'
                              ? 'Your background for small talk and behavioral questions: years on call, your stack (AWS, Kubernetes, Terraform...), an outage you handled...'
                              : 'Resume details, role requirements, constraints...'
                    }
                    .value=${this._context}
                    @input=${e => this._saveContext(e.target.value)}
                ></textarea>
                <div class="form-help">
                    ${
                        this.selectedProfile === 'lld'
                            ? 'LLD coach is already in the profile. Put only language, company, or a pasted spec here.'
                            : this.selectedProfile === 'devops'
                              ? 'Added to every DevOps answer as "About me". Answers never invent experience beyond it.'
                              : 'Sent as context at session start. Keep it short.'
                    }
                </div>
            </div>
        `;
    }
}

customElements.define('ai-customize-view', AICustomizeView);
