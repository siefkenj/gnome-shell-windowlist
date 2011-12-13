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
const THUMBNAIL_DEFAULT_SIZE = 150;
const HOVER_MENU_DELAY = 1; // seconds

// Load our extension so we can access other files in our extensions dir as libraries
const Extension = imports.ui.extensionSystem.extensions['windowlist@o2net.cl'];
const SpecialMenus = Extension.specialMenus;

const OPTIONS = {
                    DISPLAY_TITLE: 'TITLE', // TITLE: display the app title next to each icon, APP: display the app name next to each icon, NONE: display no text next to each icon
                    GROUP_BY_APP: false // true: only one button is shown for each application (all windows are grouped), false: every window has its own button
                };


const dir = function(obj){
    let props = [a for (a in obj)];
    props.concat(Object.getOwnPropertyNames(obj));
    return props;
}

// Globally variables needed for disabling the extension
let windowList, restoreState={}, clockWrapper;



// AppMenuButton is a button that will raise and lower the metaWindow associated
// with app
// @app: the application
// @metaWindow: the program's window
// @animation: whether to show a spinner
// @type: 'WINDOW' for a single-window button and 'APP' for an app-based button
function AppMenuButton(app, metaWindow, animation, type) {
    this._init(app, metaWindow, animation, type);
}

AppMenuButton.prototype = {
    _init: function(app, metaWindow, animation, type) {

        this.type = type || 'WINDOW';
        this.actor = new St.Bin({ style_class: 'panel-button',
                                  reactive: true,
                                  can_focus: true,
                                  x_fill: true,
                                  y_fill: false,
                                  track_hover: true });
        this.actor._delegate = this;
        this.actor.connect('button-release-event', Lang.bind(this, this._onButtonRelease));
        this.metaWindow = metaWindow;
        this.app = app;

        this._notify_title_signal = this.metaWindow.connect('notify::title', Lang.bind(this, this._onTitleChange));

        // We do a fancy layout with icons and labels, so we'd like to do our own allocation
        // in a Shell.GenericContainer
        this._container = new Shell.GenericContainer({ name: 'appMenu' });
        this._container.connect('get-preferred-width', Lang.bind(this, this._getContentPreferredWidth));
        this._container.connect('get-preferred-height', Lang.bind(this, this._getContentPreferredHeight));
        this._container.connect('allocate', Lang.bind(this, this._contentAllocate));
        this.actor.set_child(this._container)

        this._iconBox = new Shell.Slicer({ name: 'appMenuIcon' });
        this._iconBox.connect('style-changed', Lang.bind(this, this._onIconBoxStyleChanged));
        this._iconBox.connect('notify::allocation', Lang.bind(this, this._updateIconBoxClip));
        let icon = this.app.get_faded_icon(2 * PANEL_ICON_SIZE);
        this._iconBox.set_child(icon);
        this._container.add_actor(this._iconBox);
        this._label = new Panel.TextShadower();
        this._container.add_actor(this._label.actor);

        this._iconBottomClip = 0;

        // TODO: Should this be moved to handle all the buttons at once?
        this._visible = !Main.overview.visible;
        if (!this._visible)
            this.actor.hide();
        Main.overview.connect('hiding', Lang.bind(this, function () {
            this.show();
        }));
        Main.overview.connect('showing', Lang.bind(this, function () {
            this.hide();
        }));

        this._spinner = new Panel.AnimatedIcon('process-working.svg', PANEL_ICON_SIZE);
        this._container.add_actor(this._spinner.actor);
        this._spinner.actor.lower_bottom();


        // Set up the right click menu
        this.rightClickMenu = new SpecialMenus.RightClickAppPopupMenu(this.actor, this.metaWindow, this.app);
        this.menuManager = new PopupMenu.PopupMenuManager({actor: this.actor});
        this.menuManager.addMenu(this.rightClickMenu);
        // Set up the hover menu
        this.hoverMenu = new Extension.specialMenus.AppThumbnailHoverMenu(this.actor, this.metaWindow, this.app)
        this.hoverController = new Extension.specialMenus.HoverMenuController(this.actor, this.hoverMenu);

        // Initialize the title
        this._onTitleChange();

        if(animation){
            this.startAnimation();
            this.stopAnimation();
        }
    },

    // Call this whenever OPTIONS changes so that all the appropriate
    // settings will be updated
    refreshOptions: function() {
        this._onTitleChange();
    },

    // changeMetaWindow changes this.metaWindow to @metaWindow
    // and connects all the appropriate signals.  This is mainly used
    // if this.type == 'APP'
    changeMetaWindow: function(metaWindow) {
        this.metaWindow.disconnect(this._notify_title_signal);
        this.metaWindow = metaWindow;
        this._notify_title_signal = this.metaWindow.connect('notify::title', Lang.bind(this, this._onTitleChange));
        this.hoverMenu.changeMetaWindow(this.metaWindow);
        this._onTitleChange();
    },

    _onTitleChange: function() {
        let [title, appName] = [this.metaWindow.get_title(), this.app.get_name()];
        switch(OPTIONS['DISPLAY_TITLE']) {
            case 'TITLE':
                // Some apps take a long time to set a valid title.  We don't want to error
                // if title is null
                if (title) {
                    this._label.setText(title);
                    break;
                }
            case 'APP':
                if (appName) {
                    this._label.setText(appName);
                    break;
                }
            case 'NONE':
            default:
                this._label.setText('');
        }
    },

    doFocus: function() {
        switch (this.type) {
            case 'WINDOW':
                if ( this.metaWindow.has_focus() ) {
                    this.actor.add_style_pseudo_class('active');
                } else {
                    this.actor.remove_style_pseudo_class('active');
                }
                break;
            case 'APP':
                let tracker = Shell.WindowTracker.get_default();
                let focusedApp = tracker.focus_app;
                this.changeMetaWindow(global.display.focus_window);
                if (this.app == focusedApp){
                    this.actor.add_style_pseudo_class('active');
                } else {
                    this.actor.remove_style_pseudo_class('active');
                }
                break;
        }
    },

    _onButtonRelease: function(actor, event) {
        if ( Shell.get_event_state(event) & Clutter.ModifierType.BUTTON1_MASK ) {
            if ( this.rightClickMenu.isOpen ) {
                this.rightClickMenu.toggle();
            }
            if ( this.metaWindow.has_focus() ) {
                this.metaWindow.minimize(global.get_current_time());
            } else {
                this.metaWindow.activate(global.get_current_time());
            }
        }
    },

    show: function() {
        if (this._visible)
            return;
        this._visible = true;
        this.actor.show();
    },

    hide: function() {
        if (!this._visible)
            return;
        this._visible = false;
        this.actor.hide();
    },

    _onIconBoxStyleChanged: function() {
        let node = this._iconBox.get_theme_node();
        this._iconBottomClip = node.get_length('app-icon-bottom-clip');
        this._updateIconBoxClip();
    },

    _updateIconBoxClip: function() {
        let allocation = this._iconBox.allocation;
        if (this._iconBottomClip > 0)
            this._iconBox.set_clip(0, 0,
                                   allocation.x2 - allocation.x1,
                                   allocation.y2 - allocation.y1 - this._iconBottomClip);
        else
            this._iconBox.remove_clip();
    },

    stopAnimation: function() {
        Tweener.addTween(this._spinner.actor,
                         { opacity: 0,
                           time: SPINNER_ANIMATION_TIME,
                           transition: "easeOutQuad",
                           onCompleteScope: this,
                           onComplete: function() {
                               this._spinner.actor.opacity = 255;
                               this._spinner.actor.hide();
                           }
                         });
    },

    startAnimation: function() {
        this._spinner.actor.show();
    },

    _getContentPreferredWidth: function(actor, forHeight, alloc) {
        let [iconMinSize, iconNaturalSize] = this._iconBox.get_preferred_width(forHeight);
        let [labelMinSize, labelNaturalSize] = this._label.actor.get_preferred_width(forHeight);
        // The label text is starts in the center of the icon, so we should allocate the space
        // needed for the icon plus the space needed for(label - icon/2)
        alloc.min_size = iconMinSize + Math.max(0, labelMinSize - Math.floor(iconMinSize / 2));
        alloc.natural_size = iconNaturalSize + Math.max(0, labelNaturalSize - Math.floor(iconNaturalSize / 2));
    },

    _getContentPreferredHeight: function(actor, forWidth, alloc) {
        let [iconMinSize, iconNaturalSize] = this._iconBox.get_preferred_height(forWidth);
        let [labelMinSize, labelNaturalSize] = this._label.actor.get_preferred_height(forWidth);
        alloc.min_size = Math.max(iconMinSize, labelMinSize);
        alloc.natural_size = Math.max(iconNaturalSize, labelMinSize);
    },

    _contentAllocate: function(actor, box, flags) {
        // returns [x1,x2] so that the area between x1 and x2 is
        // centered in length
        function center(length, naturalLength) {
            let maxLength = Math.min(length, naturalLength);
            let x1 = Math.max(0, Math.floor((length - maxLength) / 2));
            let x2 = Math.min(length, x1 + maxLength);
            return [x1, x2];
        }
        let allocWidth = box.x2 - box.x1;
        let allocHeight = box.y2 - box.y1;
        let childBox = new Clutter.ActorBox();
        let direction = this.actor.get_direction();

        // Set the icon to be left-justified (or right-justified) and centered vertically
        let [iconMinWidth, iconMinHeight, iconNaturalWidth, iconNaturalHeight] = this._iconBox.get_preferred_size();
        [childBox.y1, childBox.y2] = center(allocHeight, iconNaturalHeight);
        if (direction == St.TextDirection.LTR) {
            [childBox.x1, childBox.x2] = [0, Math.min(iconNaturalWidth, allocWidth)];
        } else {
            [childBox.x1, childBox.x2] = [Math.max(0, allocWidth - iconNaturalWidth), allocWidth];
        }
        this._iconBox.allocate(childBox, flags);

        // Set the label to start its text in the center of the icon
        let iconWidth = childBox.x2 - childBox.x1;
        [minWidth, minHeight, naturalWidth, naturalHeight] = this._label.actor.get_preferred_size();
        [childBox.y1, childBox.y2] = center(allocHeight, naturalHeight);
        if (direction == St.TextDirection.LTR) {
            childBox.x1 = Math.floor(iconWidth / 2);
            childBox.x2 = Math.min(childBox.x1 + naturalWidth, allocWidth);
        } else {
            childBox.x2 = allocWidth - Math.floor(iconWidth / 2);
            childBox.x1 = Math.max(0, childBox.x2 - naturalWidth);
        }
        this._label.actor.allocate(childBox, flags);

        // Set the spinner to start in the center of the icon
        if (direction == St.TextDirection.LTR) {
            childBox.x1 = Math.floor(iconWidth / 2) + this._label.actor.width;
            childBox.x2 = childBox.x1 + this._spinner.actor.width;
            childBox.y1 = box.y1;
            childBox.y2 = box.y2 - 1;
            this._spinner.actor.allocate(childBox, flags);
        } else {
            childBox.x1 = -this._spinner.actor.width;
            childBox.x2 = childBox.x1 + this._spinner.actor.width;
            childBox.y1 = box.y1;
            childBox.y2 = box.y2 - 1;
            this._spinner.actor.allocate(childBox, flags);
        }
    }
};

// WindowList contains a list of AppMenuButton's
function WindowList() {
    this._init();
}

WindowList.prototype = {
    _init: function() {
        this.actor = new St.BoxLayout({ name: 'windowList',
                                        style_class: 'window-list-box' });
        this.actor._delegate = this;
        this._windows = [];

        let tracker = Shell.WindowTracker.get_default();
        tracker.connect('notify::focus-app', Lang.bind(this, this._onFocus));

        global.window_manager.connect('switch-workspace', Lang.bind(this, this._refreshItems));

        this._workspaces = [];
        this._recreateWorkspaces();
        this._refreshItems();
        global.screen.connect('notify::n-workspaces', Lang.bind(this, this._recreateWorkspaces));

        Main.panel.actor.connect('allocate', Lang.bind(Main.panel, this._allocateBoxes));
    },

    refreshOptions: function() {
        this._refreshItems();
    },

    _onFocus: function() {
        for (let i = 0; i < this._windows.length; ++i) {
            this._windows[i].doFocus();
        }
    },

    _refreshItems: function() {
        this.actor.destroy_children();
        this._windows = [];

        let metaWorkspace = global.screen.get_active_workspace();
        let windows = metaWorkspace.list_windows();
        windows.sort(function(w1, w2) {
            return w1.get_stable_sequence() - w2.get_stable_sequence();
        });

        // Create list items for each window
        let tracker = Shell.WindowTracker.get_default();
        for ( let i = 0; i < windows.length; ++i ) {
            let metaWindow = windows[i];
            if ( metaWindow && tracker.is_window_interesting(metaWindow) ) {
                this._windowAdded(metaWorkspace, metaWindow);
            }
        }

        this._onFocus();
    },

    _windowAdded: function(metaWorkspace, metaWindow) {
        // If the application wasn't added to the current workspace,
        // or the a button for the app already exists, we have nothing to do
        if (metaWorkspace.index() != global.screen.get_active_workspace_index()) {
            return;
        }

        let tracker = Shell.WindowTracker.get_default();
        let app = tracker.get_window_app(metaWindow);
        // If we group by apps, we only add new things when a new app is started
        if (OPTIONS.GROUP_BY_APP) {
            if (this._windows.some(function(win) { return win.app == app; })) {
                return;
            }

            if (app && tracker.is_window_interesting(metaWindow)) {
                let newButton = new AppMenuButton(app, metaWindow, true, 'APP');
                this._windows.push(newButton);
                this.actor.add(newButton.actor);
            }

        } else {
            if (this._windows.some(function(win) { return win.metaWindow == metaWindow; })) {
                return;
            }

            if (app && tracker.is_window_interesting(metaWindow)) {
                let newButton = new AppMenuButton(app, metaWindow, true, 'WINDOW');
                this._windows.push(newButton);
                this.actor.add(newButton.actor);
            }
        }
    },

    _windowRemoved: function(metaWorkspace, metaWindow) {
        if (metaWorkspace.index() != global.screen.get_active_workspace_index()) {
            return;
        }

        for (let i=0; i<this._windows.length; ++i) {
            if (this._windows[i].metaWindow == metaWindow) {
                this.actor.remove_actor(this._windows[i].actor);
                this._windows[i].actor.destroy();
                this._windows.splice(i, 1);
                break;
            }
        }
    },

    _recreateWorkspaces: function() {
        this._workspaces.forEach(function(ws) {
            ws.disconnect(ws._windowAddedId);
            ws.disconnect(ws._windowRemovedId);
        });

        this._workspaces = [];
        for (let i = 0; i < global.screen.n_workspaces; ++i) {
            let ws = global.screen.get_workspace_by_index(i);
            this._workspaces[i] = ws;
            ws._windowAddedId = ws.connect('window-added', Lang.bind(this, this._windowAdded));
            ws._windowRemovedId = ws.connect('window-removed', Lang.bind(this, this._windowRemoved));
        }
    },

    _allocateBoxes: function(container, box, flags) {
        let allocWidth = box.x2 - box.x1;
        let allocHeight = box.y2 - box.y1;
        let [leftMinWidth, leftNaturalWidth] = this._leftBox.get_preferred_width(-1);
        let [centerMinWidth, centerNaturalWidth] = this._centerBox.get_preferred_width(-1);
        let [rightMinWidth, rightNaturalWidth] = this._rightBox.get_preferred_width(-1);

        let sideWidth, centerWidth;
        centerWidth = centerNaturalWidth;
        sideWidth = (allocWidth - centerWidth) / 2;

        let childBox = new Clutter.ActorBox();

        childBox.y1 = 0;
        childBox.y2 = allocHeight;
        if (this.actor.get_direction() == St.TextDirection.RTL) {
            childBox.x1 = allocWidth - Math.min(allocWidth - rightNaturalWidth, leftNaturalWidth);
            childBox.x2 = allocWidth;
        } else {
            childBox.x1 = 0;
            childBox.x2 = Math.min(allocWidth - rightNaturalWidth, leftNaturalWidth);
        }
        this._leftBox.allocate(childBox, flags);

        childBox.x1 = Math.ceil(sideWidth);
        childBox.y1 = 0;
        childBox.x2 = childBox.x1 + centerWidth;
        childBox.y2 = allocHeight;
        this._centerBox.allocate(childBox, flags);

        childBox.y1 = 0;
        childBox.y2 = allocHeight;
        if (this.actor.get_direction() == St.TextDirection.RTL) {
            childBox.x1 = 0;
            childBox.x2 = Math.min(Math.floor(sideWidth), rightNaturalWidth);
        } else {
            childBox.x1 = allocWidth - Math.min(Math.floor(sideWidth), rightNaturalWidth);
            childBox.x2 = allocWidth;
        }
        this._rightBox.allocate(childBox, flags);
    }
};

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
    windowList = new WindowList();
}

function enable() {
    /* Move Clock - http://www.fpmurphy.com/gnome-shell-extensions/moveclock.tar.gz */
    let _children = Main.panel._rightBox.get_children();
    let _clock    = Main.panel._dateMenu;
    restoreState["_dateMenu"] = _clock.actor.get_parent();
    restoreState["_dateMenu"].remove_actor(_clock.actor);
    // Add a wrapper around the clock so it won't get squished (ellipsized)
    // and so that it doesn't resize when the time chagnes
    clockWrapper = new StableLabel(_clock);
    Main.panel._rightBox.insert_actor(clockWrapper.actor, _children.length - 1);

    /* Remove Application Menu */
    restoreState["applicationMenu"] = Main.panel._appMenu.actor;
    Main.panel._leftBox.remove_actor(restoreState["applicationMenu"]);

    /* Place the Window List */
    Main.panel._leftBox.add(windowList.actor);
}

function disable() {
    /* Remove the Window List */
    Main.panel._leftBox.remove_actor(windowList.actor);

    /* Restore Application Menu */
    Main.panel._leftBox.add(restoreState["applicationMenu"]);

    /* unmove the clock */
    let _clock = Main.panel._dateMenu;
    let _clock_parent = _clock.actor.get_parent();
    if (_clock_parent) {
        _clock_parent.remove_actor(_clock.actor);
    }
    if (restoreState["_dateMenu"]) {
        restoreState["_dateMenu"].add(_clock.actor, 0);
        clockWrapper.destroy();
    }
}
