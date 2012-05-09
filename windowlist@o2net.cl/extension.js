//vim: expandtab shiftwidth=4 tabstop=8 softtabstop=4 encoding=utf-8 textwidth=99
/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

// Gnome Shell Window List
// Authors:
//   Kurt Rottmann <kurtrottmann@gmail.com>
//   Jason Siefken

// Taking code from
// Copyright (C) 2011 R M Yorston
// Licence: GPLv2+
// http://intgat.tigress.co.uk/rmy/extensions/gnome-shell-frippery-0.2.3.tgz

const Clutter = imports.gi.Clutter;
const Lang = imports.lang;
const Shell = imports.gi.Shell;
const St = imports.gi.St;
const Main = imports.ui.main;
const Mainloop = imports.mainloop;
const Tweener = imports.ui.tweener;
const Overview = imports.ui.overview;
const Panel = imports.ui.panel;
//const AppIcon = imports.ui.appIcon;
const PopupMenu = imports.ui.popupMenu;
const PanelMenu = imports.ui.panelMenu;
const Signals = imports.signals;

const PANEL_ICON_SIZE = 24;
const SPINNER_ANIMATION_TIME = 1;
const THUMBNAIL_DEFAULT_SIZE = 120;
const HOVER_MENU_DELAY = 1; // seconds

// Load our extension so we can access other files in our extensions dir as libraries
const Extension = imports.misc.extensionUtils.getCurrentExtension();
const SpecialMenus = Extension.imports.specialMenus;
const SpecialButtons = Extension.imports.specialButtons;

const OPTIONS = {
                    // DISPLAY_TITLE
                    //     TITLE: display the app title next to each icon
                    //     APP: display the app name next to each icon
                    //     NONE: display no text next to each icon
                    // Note, this option only applies when app grouping is enabled
                    DISPLAY_TITLE: 'TITLE',
                    // GROUP_BY_APP
                    //     true: only one button is shown for each application (all windows are grouped)
                    //     false: every window has its own button
                    GROUP_BY_APP: true
                };

// Globally variables needed for disabling the extension
let windowListManager, restoreState={}, clockWrapper, appTracker;



// Some functional programming tools
const dir = function(obj){
    let props = [a for (a in obj)];
    props.concat(Object.getOwnPropertyNames(obj));
    return props;
}

const range = function(a, b) {
    let ret = []
    // if b is unset, we want a to be the upper bound on the range
    if (b == null) {
        [a, b] = [0, a]
    }

    for (let i = a; i < b; i++) {
        ret.push(i);
    }
    return ret;
}

const zip = function(a, b) {
    let ret = [];
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
        ret.push([a[i], b[i]]);
    }
    return ret;
}

const unzip = function(a) {
    let ret1 = [], ret2 = [];
    a.forEach(function(tuple) {
        ret1.push(tuple[0]);
        ret2.push(tuple[1]);
    });

    return [ret1, ret2];
}

// A hash-like object that preserves order
// and is sortable
function OrderedHash() {
    this._init.apply(this, arguments);
}

OrderedHash.prototype = {
    _init: function(keys, items) {
        this._items = items || [];
        this._keys = keys || [];
    },

    toString: function() {
        let ret = [ this._keys[i] + ': ' + this._items[i] for each (i in range(this._keys.length)) ];
        return '{' + ret.join(', ') + '}';
    },

    set: function(key, val) {
        let i = this._keys.indexOf(key);
        if (i == -1) {
            this._keys.push(key);
            this._items.push(val);
        } else {
            this._items[i] = val;
        }
        return val;
    },

    // Given an array of keys, the entries [key: initializer(key)]
    // are added
    setKeys: function(keys, initializer) {
        keys.forEach(Lang.bind(this, function(key) {
            this.set(key, initializer(key));
        }));
    },

    get: function(key) {
        let i = this._keys.indexOf(key);
        if (i == -1) {
            return undefined;
        }
        return this._items[i];
    },

    // returns [key, items] corresponding
    // to the index
    getPair: function(index) {
        index = index || 0;
        return [this._keys[index], this._items[index]];
    },

    contains: function(key) {
        return this._keys.indexOf(key) != -1;
    },

    remove: function(key) {
        let i = this._keys.indexOf(key);
        let ret = null;
        if (i != -1) {
            this._keys.splice(i, 1);
            ret = this._items.splice(i, 1)[0];
        }
        return ret;
    },

    keys: function() {
        return this._keys.slice();
    },

    items: function() {
        return this._items.slice();
    },

    sort: function(sortFunc) {
        this.sortByKeys(sortFunc);
    },

    sortByKeys: function(sortFunc) {
        let pairs = zip(this._keys, this._items);
        pairs.sort(Lang.bind(this, function(a, b) {
           return sortFunc(a[0], b[0]);
        }));
        [this._keys, this._items] = unzip(pairs);
    },

    sortByItems: function(sortFunc) {
        let pairs = zip(this._keys, this._items);
        pairs.sort(Lang.bind(this, function(a, b) {
           return sortFunc(a[1], b[1]);
        }));
        [this._keys, this._items] = unzip(pairs);
    },

    // Call forFunc(key, item) on each (key, item) pair.
    forEach: function(forFunc) {
        let pairs = zip(this._keys, this._items);
        pairs.forEach(function(a) {
            forFunc(a[0], a[1]);
        });
    }
};

// Connects and keeps track of signal IDs so that signals
// can be easily disconnected
function SignalTracker() {
    this._init.apply(this, arguments);
}

SignalTracker.prototype = {
    _init: function() {
        this._data = [];
    },

    // params = {
    //              signalName: Signal Name
    //              callback: Callback Function
    //              bind: Context to bind to
    //              object: object to connect to
    //}
    connect: function(params) {
        let signalName = params['signalName'];
        let callback = params['callback'];
        let bind = params['bind'];
        let object = params['object'];
        let signalID = null;

        signalID = object.connect(signalName, Lang.bind(bind, callback));
        this._data.push({
            signalName: signalName,
            callback: callback,
            object: object,
            signalID: signalID,
            bind: bind
        });
    },

    disconnect: function(param) {

    },

    disconnectAll: function() {
        this._data.forEach(function(data) {
            data['object'].disconnect(data['signalID']);
            for (let prop in data) {
                data[prop] = null;
            }
        });
        this._data = [];
    }
};

// Tracks what applications are associated with the
// given metawindows.  Will return tracker.get_window_app
// if it is non-null.  Otherwise, it will look it up in
// its internal database.  If that fails, it will throw an exception
// This is a work around for https://bugzilla.gnome.org/show_bug.cgi?id=666472
function AppTracker() {
    this._init.apply(this, arguments);
}

AppTracker.prototype = {
    _init: function(tracker) {
        this.tracker = tracker || Shell.WindowTracker.get_default();
        this.hash = new OrderedHash();
    },

    get_window_app: function(metaWindow) {
        let app = this.tracker.get_window_app(metaWindow);
        // If we found a valid app, we should add it to our hash,
        // otherwise, try to look it up in our hash
        if (app == null) {
            app = this.hash.get(metaWindow);
        } else {
            this.hash.set(metaWindow, app);
        }

        if (!app)
            throw { name: 'AppTrackerError', message: 'get_window_app returned null and there was no record of metaWindow in internal database' };

        return app;
    },

    is_window_interesting: function(metaWindow) {
        return this.tracker.is_window_interesting(metaWindow);
    }
};



// AppGroup is a container that keeps track
// of all windows of @app (all windows on workspaces
// that are watched, that is).
function AppGroup() {
    this._init.apply(this, arguments);
}

AppGroup.prototype = {
    _init: function(app) {
        this.app = app;
        this.metaWindows = new OrderedHash();
        this.metaWorkspaces = new OrderedHash();

        this.actor = new St.Bin({ style_class: 'panel-button',
                                  reactive: true,
                                  can_focus: true,
                                  x_fill: true,
                                  y_fill: false,
                                  track_hover: true });
        this.actor._delegate = this;

        this._box = new St.BoxLayout({ reactive: true });
        this._windowButtonBox = new SpecialButtons.ButtonBox();
        this._appButton = new SpecialButtons.AppButton({ app: this.app,
                                                         iconSize: PANEL_ICON_SIZE });
        this._appButton.actor.connect('button-release-event', Lang.bind(this, this._onAppButtonRelease));
        this._box.add_actor(this._appButton.actor);
        this._box.add_actor(this._windowButtonBox.actor);
        this.actor.child = this._box;


        this.appButtonVisible = true;
        this.windowButtonsVisible = true;

        // Set up the right click menu
        this.rightClickMenu = new SpecialMenus.RightClickAppPopupMenu(this.actor, this);
        this.menuManager = new PopupMenu.PopupMenuManager({actor: this.actor});
        this.menuManager.addMenu(this.rightClickMenu);
        // Set up the hover menu
        this.hoverMenu = new SpecialMenus.AppThumbnailHoverMenu(this.actor, this.metaWindow, this.app)
        this.hoverController = new SpecialMenus.HoverMenuController(this.actor, this.hoverMenu);
    },

    // Add a workspace to the list of workspaces that are watched for
    // windows being added and removed
    watchWorkspace: function(metaWorkspace) {
        if (!this.metaWorkspaces.contains(metaWorkspace)) {
            // We use connect_after so that the window-tracker time to identify the app, otherwise get_window_app might return null!
            let windowAddedSignal = metaWorkspace.connect_after('window-added', Lang.bind(this, this._windowAdded));
            let windowRemovedSignal = metaWorkspace.connect_after('window-removed', Lang.bind(this, this._windowRemoved));
            this.metaWorkspaces.set(metaWorkspace, { workspace: metaWorkspace,
                                                     signals: [windowAddedSignal, windowRemovedSignal] });
        }
    },

    // Stop monitoring a workspace for added and removed windows.
    // @metaWorkspace: if null, will remove all signals
    unwatchWorkspace: function(metaWorkspace) {
        function removeSignals(obj) {
            obj.signals.forEach(function(s) {
                obj.workspace.disconnect(s);
            });
        }

        if (metaWorkspace == null) {
            for each (let k in this.metaWorkspaces.keys()) {
                removeSignals(this.metaWorkspaces.get(k));
                this.metaWorkspaces.remove(k);
            }
        } else if (this.metaWorkspaces.contains(metaWorkspace)) {
            removeSignals(this.metaWorkspaces.get(metaWorkspace));
            this.metaWorkspaces.remove(metaWorkspace);
        } else {
            global.log('Warning: tried to remove watch on an unwatched workspace');
        }
    },

    hideWindowButtons: function(animate) {
        this._windowButtonBox.hide(animate);
        this.windowButtonsVisible = false;
    },

    showWindowButtons: function(animate) {
        let targetWidth = null;
        if (animate)
            targetWidth = this.actor.width;
        this._windowButtonBox.show(animate, targetWidth);
        this.windowButtonsVisible = true;
    },

    hideAppButton: function(animate) {
        this._appButton.hide(animate);
        this.appButtonVisible = false;
    },

    showAppButton: function(animate) {
        let targetWidth = null;
        if (animate)
            targetWidth = this.actor.width;
        this._appButton.show(animate, targetWidth);
        this.appButtonVisible = true;
    },

    hideAppButtonLabel: function(animate) {
        this._appButton.hideLabel(animate)
    },

    showAppButtonLabel: function(animate) {
        this._appButton.showLabel(animate)
    },

    _onAppButtonRelease: function(actor, event) {
        if (!this.lastFocused)
            return;

        if (event.get_state() & Clutter.ModifierType.BUTTON1_MASK) {
            if (this.rightClickMenu && this.rightClickMenu.isOpen) {
                this.rightClickMenu.toggle();
            }
            if (this.lastFocused.appears_focused) {
                this.lastFocused.minimize(global.get_current_time());
            } else {
                this.lastFocused.activate(global.get_current_time());
            }
        }
    },

    _getLastFocusedWindow: function() {
        // Get a list of windows and sort it in order of last access
        let list = [ [win.user_time, win] for each (win in this.metaWindows.keys()) ]
        list.sort(function(a,b) { return a[0] - b[0]; });
        if (list[0])
            return list[0][1];
        else
            return null
    },

    // updates the internal list of metaWindows
    // to include all windows corresponding to this.app on the workspace
    // metaWorkspace
    _updateMetaWindows: function(metaWorkspace) {
        let tracker = Shell.WindowTracker.get_default();
        // Get a list of all interesting windows that are part of this app on the current workspace
        let windowList = metaWorkspace.list_windows().filter(Lang.bind(this, function(metaWindow) {
            try {
                return tracker.get_window_app(metaWindow) == this.app && tracker.is_window_interesting(metaWindow);
            } catch (e) {
                log(e.name + ': ' + e.message);
                return false;
            }
        }));
        this.metaWindows = new OrderedHash();
        this._windowButtonBox.clear();
        windowList.forEach(Lang.bind(this, function(win) {
            this._windowAdded(null, win);
        }));

        // When we first populate we need to decide which window
        // will be triggered when the app button is pressed
        if (!this.lastFocused) {
            this.lastFocused = this._getLastFocusedWindow();
        }
        if (this.lastFocused) {
            this._windowTitleChanged(this.lastFocused);
            this.hoverMenu.setMetaWindow(this.lastFocused);
        }
    },

    _windowAdded: function(metaWorkspace, metaWindow) {
        let tracker = Shell.WindowTracker.get_default();
        if (tracker.get_window_app(metaWindow) == this.app && !this.metaWindows.contains(metaWindow) && tracker.is_window_interesting(metaWindow)) {
            let button = new SpecialButtons.WindowButton({ app: this.app,
                                                           metaWindow: metaWindow,
                                                           iconSize: PANEL_ICON_SIZE,
                                                           textOffsetFactor: 0.4 });
            this._windowButtonBox.add(button);
            let signals = [];
            signals.push(metaWindow.connect('notify::title', Lang.bind(this, this._windowTitleChanged)));
            signals.push(metaWindow.connect('notify::appears-focused', Lang.bind(this, this._focusWindowChange)));
            let data = { signals: signals,
                         windowButton: button };
            this.metaWindows.set(metaWindow, data);
            this.metaWindows.sort(function(w1, w2) {
                return w1.get_stable_sequence() - w2.get_stable_sequence();
            });
        }
    },

    _windowRemoved: function(metaWorkspace, metaWindow) {
        let deleted = this.metaWindows.remove(metaWindow);
        if (deleted != null) {
            // Clean up all the signals we've connected
            deleted['signals'].forEach(function(s) {
                metaWindow.disconnect(s);
            });
            this._windowButtonBox.remove(deleted['windowButton']);
            deleted['windowButton'].destroy();

            // Make sure we don't leave our appButton hanging!
            // That is, we should no longer display the old app in our title
            let nextWindow = this.metaWindows.keys()[0];
            if (nextWindow) {
                this.lastFocused = nextWindow;
                this._windowTitleChanged(this.lastFocused);
                this.hoverMenu.setMetaWindow(this.lastFocused);
            }
        }
    },

    _windowTitleChanged: function(metaWindow) {
        // We only really want to track title changes of the last focused app
        if (metaWindow != this.lastFocused)
            return;
        if (!this._appButton) {
            throw 'Error: got a _windowTitleChanged callback but this._appButton is undefined';
            return;
        }

        let [title, appName] = [metaWindow.get_title(), this.app.get_name()];
        switch(OPTIONS['DISPLAY_TITLE']) {
            case 'TITLE':
                // Some apps take a long time to set a valid title.  We don't want to error
                // if title is null
                if (title) {
                    this._appButton.setText(title);
                    break;
                }
            case 'APP':
                if (appName) {
                    this._appButton.setText(appName);
                    break;
                }
            case 'NONE':
            default:
                this._appButton.setText('');
        }
    },

    _focusWindowChange: function(metaWindow) {
        if (metaWindow.appears_focused) {
            this.lastFocused = metaWindow;
            this._windowTitleChanged(this.lastFocused);
            this.hoverMenu.setMetaWindow(this.lastFocused);
        }
        this._updateFocusedStatus();
    },

    // Monitors whether any windows of this.app have focus
    // Emits a focus-status-change event if this chagnes
    _updateFocusedStatus: function() {
        let changed = false;
        let focusState = this.metaWindows.keys().some(function(win) { return win.appears_focused; });
        if (this.focusState !== focusState) {
            this.emit('focus-state-change', focusState);
        }
        this.focusState = focusState;
    },

    destroy: function() {
        // Unwatch all workspaces before we destroy all our actors
        // that callbacks depend on
        this.unwatchWorkspace(null);
        this.metaWindows.forEach(function(win, data) {
            data['signals'].forEach(function(s) {
                win.disconnect(s);
            });
        });

        this._appButton.destroy();
        this._windowButtonBox.destroy();
        this.actor.destroy();
        this._appButton = null;
        this._windowButtonBox = null;
        this.actor = null;
    }
};
Signals.addSignalMethods(AppGroup.prototype)


// List of running apps
function AppList() {
    this._init.apply(this, arguments);
}

AppList.prototype = {
    _init: function(metaWorkspace) {
        this.actor = new St.BoxLayout({ name: 'windowList',
                                        style_class: 'window-list-box' });
        this.actor._delegate = this;

        this.metaWorkspace = metaWorkspace;
        this._appList = new OrderedHash();
        // We need a backup database of the associated app for each metaWindow since something get_window_app will return null
        this._tracker = new AppTracker(Shell.WindowTracker.get_default());
        this._refreshApps();
        this.signals = [];
        // We use connect_after so that the window-tracker time to identify the app
        this.signals.push(this.metaWorkspace.connect_after('window-added', Lang.bind(this, this._windowAdded)));
        this.signals.push(this.metaWorkspace.connect_after('window-removed', Lang.bind(this, this._windowRemoved)));
    },

    // Gets a list of every app on the current workspace
    _refreshApps: function() {
        //let tracker = Shell.WindowTracker.get_default();
        let tracker = this._tracker;

        // For eachw window, let's make sure we add it!
        this.metaWorkspace.list_windows().forEach(Lang.bind(this, function(win) {
            this._windowAdded(this.metaWorkspace, win);
        }));
    },

    _windowAdded: function(metaWorkspace, metaWindow) {
        // Check to see if the window that was added already has an app group.
        // If it does, then we don't need to do anything.  If not, we need to
        // create an app group.
        //let tracker = Shell.WindowTracker.get_default();
        let tracker = this._tracker;
        let app;
        try {
            app = tracker.get_window_app(metaWindow);
        } catch (e) {
            log(e.name + ': ' + e.message);
            return;
        }
        if (!this._appList.contains(app)) {
            let appGroup = new AppGroup(app);
            appGroup._updateMetaWindows(metaWorkspace);
            appGroup.watchWorkspace(metaWorkspace);

            if (OPTIONS['GROUP_BY_APP']) {
                appGroup.hideWindowButtons();
            } else {
                appGroup.hideAppButton();
            }

            this.actor.add_actor(appGroup.actor);

            // We also need to monitor the state 'cause some pesky apps (namely: plugin_container left over after fullscreening a flash video)
            // don't report having zero windows after they close
            let appStateSignal = app.connect('notify::state', Lang.bind(this, function(app) {
                if (app.state == Shell.AppState.STOPPED && this._appList.contains(app)) {
                    this._removeApp(app);
                }
            }));

            this._appList.set(app, { appGroup: appGroup, signals: [appStateSignal] });
            // TODO not quite ready yet for prime time
            /* appGroup.connect('focus-state-change', function(group, focusState) {
                if (focusState) {
                    group.showAppButtonLabel(true);
                } else {
                    group.hideAppButtonLabel(true);
                }
            }); */
        }
    },

    _removeApp: function(app) {
        // This function may get called multiple times on the same app and so the app may have already been removed
        let appGroup = this._appList.remove(app);
        if (appGroup) {
            appGroup['appGroup'].destroy();
            appGroup['signals'].forEach(function(s) {
                app.disconnect(s);
            });
        }
    },

    _windowRemoved: function(metaWorkspace, metaWindow) {
        // When a window is closed, we need to check if the app it belongs
        // to has no windows left.  If so, we need to remove the corresponding AppGroup
        //let tracker = Shell.WindowTracker.get_default();
        let tracker = this._tracker;
        let app;
        try {
            app = tracker.get_window_app(metaWindow);
        } catch (e) {
            log(e.name + ': ' + e.message);
            return;
        }
        let hasWindowsOnWorkspace = app.get_windows().some(function(win) { return win.get_workspace() == metaWorkspace; });
        if (app && !hasWindowsOnWorkspace) {
            this._removeApp(app);
        }
    },

    destroy: function() {
        this.signals.forEach(Lang.bind(this, function(s) {
            this.metaWorkspace.disconnect(s);
        }));
        this._appList.forEach(function(app, data) {
            data['appGroup'].destroy();
        });
        this._appList = null;
    }
};


// Manages window/app lists and takes care of
// hiding/showing them and manages switching workspaces, etc.
function WindowListManager() {
    this._init.apply(this, arguments);
}

WindowListManager.prototype = {
    _init: function() {
        this.actor = new St.Bin({ name: 'WindowListManager' });
        this.actor._delegate = this;

        this.metaWorkspaces = new OrderedHash();

        // Use a signal tracker so we don't have to keep track of all these id's manually!
        //  global.window_manager.connect('switch-workspace', Lang.bind(this, this._onSwitchWorkspace));
        //  global.screen.connect('notify::n-workspaces', Lang.bind(this, this._onWorkspaceCreatedOrDestroyed));
        //  Main.overview.connect('showing', Lang.bind(this, this._onOverviewShow));
        //  Main.overview.connect('hiding', Lang.bind(this, this._onOverviewHide));
        this.signals = new SignalTracker();
        this.signals.connect({ object: global.window_manager,
                               signalName: 'switch-workspace',
                               callback: this._onSwitchWorkspace,
                               bind: this });
        this.signals.connect({ object: global.screen,
                               signalName: 'notify::n-workspaces',
                               callback: this._onWorkspaceCreatedOrDestroyed,
                               bind: this });
        this.signals.connect({ object: Main.overview,
                               signalName: 'showing',
                               callback: this._onOverviewShow,
                               bind: this });
        this.signals.connect({ object: Main.overview,
                               signalName: 'hiding',
                               callback: this._onOverviewHide,
                               bind: this });
        this._onSwitchWorkspace(null, null, global.screen.get_active_workspace_index());
    },

    _onWorkspaceCreatedOrDestroyed: function() {
       let workspaces = [ global.screen.get_workspace_by_index(i) for each (i in range(global.screen.n_workspaces)) ];
       // We'd like to know what workspaces in this.metaWorkspaces have been destroyed and
       // so are no longer in the workspaces list.  For each of those, we should destroy them
       let toDelete = [];
       this.metaWorkspaces.forEach(Lang.bind(this, function(ws, data) {
            if (workspaces.indexOf(ws) == -1) {
                data['appList'].destroy();
                toDelete.push(ws);
            }
       }));
       toDelete.forEach(Lang.bind(this, function(item) {
            this.metaWorkspaces.remove(item);
       }));
    },

    _onSwitchWorkspace: function(winManager, previousWorkspaceIndex, currentWorkspaceIndex) {
        let metaWorkspace = global.screen.get_workspace_by_index(currentWorkspaceIndex);
        // If the workspace we switched to isn't in our list,
        // we need to create an AppList for it
        if (!this.metaWorkspaces.contains(metaWorkspace)) {
            let appList = new AppList(metaWorkspace);
            this.metaWorkspaces.set(metaWorkspace, { 'appList': appList });
        }

        // this.actor can only have one child, so setting the child
        // will automatically unparent anything that was previously there, which
        // is exactly what we want.
        this.actor.child = this.metaWorkspaces.get(metaWorkspace)['appList'].actor;
    },

    _onOverviewShow: function() {
        this.actor.hide();
    },

    _onOverviewHide: function() {
        this.actor.show();
    },

    destroy: function() {
        this.signals.disconnectAll();
        this.actor.destroy();
        this.actor = null;
    }
}


// A widget that won't get squished
// and won't continually resize when the text inside
// it changes, provided the number of characters inside
// doesn't change
function StableLabel(dateMenu) {
    this._init.call(this, dateMenu);
}

StableLabel.prototype = {
    _init: function(dateMenu) {
        this.actor = new Shell.GenericContainer({ visible: true,
                                                  reactive: true });
        this.actor.connect('get-preferred-width', Lang.bind(this, this._getPreferredWidth));
        this.actor.connect('get-preferred-height', Lang.bind(this, this._getPreferredHeight));
        this.actor.connect('allocate', Lang.bind(this, this._allocate));

        this._dateMenu = dateMenu.actor;
        this.label = dateMenu._clock;

        // We keep track of the current maximum width
        // needed to display the label.  As long as the number
        // of character is the label doesn't change, our width
        // should be monotone increasing
        this.width = 0;
        this.numChars = 0;

        this.actor.add_actor(this._dateMenu);
    },

    destroy: function() {
        this.actor.destroy();
        this._dateMenu = null;
        this.label = null;
    },

    _getPreferredWidth: function(actor, forWidth, alloc) {
        let [minWidth, preferredWidth] = this._dateMenu.get_preferred_width(forWidth);

        this.width = Math.max(this.width, preferredWidth);
        if (this.label.text.length != this.numChars) {
            this.numChars = this.label.text.length;
            this.width = preferredWidth;
        }

        alloc.min_size = this.width;
        alloc.natural_size = this.width;
    },

    _getPreferredHeight: function(actor, forHeight, alloc) {
        let [minHeight, preferredHeight] = this._dateMenu.get_preferred_width(forHeight);
        alloc.min_size = minHeight;
        alloc.natural_size = preferredHeight;
    },

    _allocate: function(actor, box, flags) {
        let childBox = new Clutter.ActorBox();

        childBox.x1 = 0;
        childBox.y1 = 0;
        childBox.x2 = this.actor.width;
        childBox.y2 = this.actor.height;
        this._dateMenu.allocate(childBox, flags);
    }
};

function init() {
}

function enable() {
    /* Move Clock - http://www.fpmurphy.com/gnome-shell-extensions/moveclock.tar.gz */
//    let _children = Main.panel._rightBox.get_children();
//    let _clock    = Main.panel._dateMenu;
//    restoreState["_dateMenu"] = _clock.actor.get_parent();
//    restoreState["_dateMenu"].remove_actor(_clock.actor);
    // Add a wrapper around the clock so it won't get squished (ellipsized)
    // and so that it doesn't resize when the time chagnes
//    clockWrapper = new StableLabel(_clock);
//    Main.panel._rightBox.insert_actor(clockWrapper.actor, _children.length - 1);

    /* Remove Application Menu */
    restoreState["applicationMenu"] = Main.panel._appMenu.actor;
    Main.panel._leftBox.remove_actor(restoreState["applicationMenu"]);

    /* Create and place the Window List */
    windowListManager = new WindowListManager();
    Main.panel._leftBox.add_actor(windowListManager.actor);
}

function disable() {
    /* Remove the Window List and Destroy it*/
    Main.panel._leftBox.remove_actor(windowListManager.actor);
    windowListManager.destroy();
    windowListManager = null;

    /* Restore Application Menu */
    Main.panel._leftBox.add(restoreState["applicationMenu"]);

    /* unmove the clock */
//    let _clock = Main.panel._dateMenu;
//    let _clock_parent = _clock.actor.get_parent();
//    if (_clock_parent) {
//        _clock_parent.remove_actor(_clock.actor);
//    }
//    if (restoreState["_dateMenu"]) {
//        restoreState["_dateMenu"].add(_clock.actor, 0);
//        clockWrapper.destroy();
//    }
}
