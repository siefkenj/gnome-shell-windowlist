//vim: expandtab shiftwidth=4 tabstop=8 softtabstop=4 encoding=utf-8 textwidth=99
/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

// Some special subclasses of popupMenu
// such that the menu can be opened via a
// particular button only, or via hovering


const Clutter = imports.gi.Clutter;
const Lang = imports.lang;
const Main = imports.ui.main;
const Mainloop = imports.mainloop;
const Params = imports.misc.params;
const PopupMenu = imports.ui.popupMenu;
const Shell = imports.gi.Shell;
const St = imports.gi.St;


const HOVER_MENU_TIMEOUT = 1000;
const THUMBNAIL_DEFAULT_SIZE = 150;

function RightClickPopupMenu() {
    this._init.apply(this, arguments);
}

RightClickPopupMenu.prototype = {
    __proto__: PopupMenu.PopupMenu.prototype,

    _init: function(actor, params) {
        // openOnButton: which button opens the menu
        params = Params.parse(params, { openOnButton: 3 });
        
        PopupMenu.PopupMenu.prototype._init.call(this, actor, 0, St.Side.TOP);
        
        this.openOnButton = params.openOnButton;
        this._parentActor = actor;
        this._parentActor.connect('button-release-event', Lang.bind(this, this._onParentActorButtonRelease));
        
        this.actor.hide();
        Main.uiGroup.add_actor(this.actor);
    },

    _onParentActorButtonRelease: function(actor, event) {
        let buttonMask = Clutter.ModifierType['BUTTON' + this.openOnButton + '_MASK'];
        if (Shell.get_event_state(event) & buttonMask) {
            this.toggle();
        }
        
    }
};


function HoverMenuController() {
    this._init.apply(this, arguments);
}

HoverMenuController.prototype = {
    _init: function(actor, menu, params) {
        // reactive: should the menu stay open if your mouse is above the menu
        // clickShouldImpede: if you click actor, should the menu be prevented from opening
        // clickShouldClose: if you click actor, should the menu close
        params = Params.parse(params, { reactive: true,
                                        clickShouldImpede: true,
                                        clickShouldClose: true });
        
        this._parentActor = actor;
        this._parentMenu = menu;

        this._parentActor.reactive = true;
        this._parentActor.connect('enter-event', Lang.bind(this, this._onEnter));
        this._parentActor.connect('leave-event', Lang.bind(this, this._onLeave));

        // If we're reactive, it means that we can move our mouse to the popup
        // menu and interact with it.  It shouldn't close while we're interacting
        // with it.
        if (params.reactive) {
            this._parentMenu.actor.connect('enter-event', Lang.bind(this, this._onParentMenuEnter));
            this._parentMenu.actor.connect('leave-event', Lang.bind(this, this._onParentMenuLeave));
        }

        if (params.clickShouldImpede || params.clickShouldClose) {
            this.clickShouldImpede = params.clickShouldImpede;
            this.clickShouldClose = params.clickShouldClose;
            this._parentActor.connect('button-press-event', Lang.bind(this, this._onButtonPress));
        }
    },

    _onButtonPress: function() {
        if (this.clickShouldImpede) {
            this.shouldOpen = false;
        }
        if (this.clickShouldClose) {
            if (!this.impedeClose) {
                this.shouldClose = true;
            }
            this.close();
        }
    },

    _onParentMenuEnter: function() {
        this.shouldClose = false;
    },

    _onParentMenuLeave: function() {
        this.shouldClose = true;

        Mainloop.timeout_add(HOVER_MENU_TIMEOUT, Lang.bind(this, this.close));
    },

    _onEnter: function() {
        if (!this.impedeOpen) {
            this.shouldOpen = true;
        }
        this.shouldClose = false;

        Mainloop.timeout_add(HOVER_MENU_TIMEOUT, Lang.bind(this, this.open));
    },

    _onLeave: function() {
        if (!this.impedeClose) {
            this.shouldClose = true;
        }
        this.shouldOpen = false;

        Mainloop.timeout_add(HOVER_MENU_TIMEOUT, Lang.bind(this, this.close));
    },

    open: function() {
        if (this.shouldOpen && !this._parentMenu.isOpen) {
            this._parentMenu.open(true);
        }
    },

    close: function() {
        if (this.shouldClose) {
            this._parentMenu.close(true);
        }
    },

    enable: function() {
        this.impedeOpen = false;
    },

    disable: function() {
        this.impedeOpen = true;
    }
};

function HoverMenu() {
    this._init.apply(this, arguments);
}

HoverMenu.prototype = {
    __proto__: PopupMenu.PopupMenu.prototype,

    _init: function(actor, params) {
        PopupMenu.PopupMenu.prototype._init.call(this, actor, 0, St.Side.TOP);

        params = Params.parse(params, { reactive: true });

        this._parentActor = actor;

        this.actor.hide();
        
        if (params.reactive) {
            Main.layoutManager.addChrome(this.actor);
        } else {
            Main.uiGroup.add_actor(this.actor);
        }
    }
};

function AppThumbnailHoverMenu() {
    this._init.apply(this, arguments);
}

AppThumbnailHoverMenu.prototype = {
    __proto__: HoverMenu.prototype,

    _init: function(actor, metaWindow, app) {
        HoverMenu.prototype._init.call(this, actor, { reactive: true });

        this.metaWindow = metaWindow;
        this.app = app;
    },

    open: function(animate) {
        this.generateThumbnail();
        PopupMenu.PopupMenu.prototype.open.call(this, animate);
    },
    
    generateThumbnail: function() {
        // If we already made a thumbnail, we don't need to make it again
        if (this.thumbnail) {
            return;
        }

        // Get a pretty thumbnail of our app
        let mutterWindow = this.metaWindow.get_compositor_private();
        if (mutterWindow) {
            let windowTexture = mutterWindow.get_texture();
            let [width, height] = windowTexture.get_size();
            let scale = Math.min(1.0, THUMBNAIL_DEFAULT_SIZE / width, THUMBNAIL_DEFAULT_SIZE / height);
            this.thumbnail = new Clutter.Clone ({ source: windowTexture,
                                                  reactive: true,
                                                  width: width * scale,
                                                  height: height * scale });

            this.thumnailMenuItem = new PopupMenuThumbnailItem(this.thumbnail);
            this.addMenuItem(this.thumnailMenuItem);
            this.thumnailMenuItem.connect('activate', Lang.bind(this, function() {
                this.metaWindow.activate(global.get_current_time());
            }));
        }
    }
}

function RightClickAppPopupMenu() {
    this._init.apply(this, arguments);
}

RightClickAppPopupMenu.prototype = {
    __proto__: RightClickPopupMenu.prototype,

    _init: function(actor, metaWindow, app, params) {
        RightClickPopupMenu.prototype._init.call(this, actor, params);
        
        this.metaWindow = metaWindow;
        this.app = app;

        this._menuItemName = new PopupMenu.PopupMenuItem(this.app.get_name(), { reactive: false });
        this.addMenuItem(this._menuItemName);

        this.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._menuItemCloseWindow = new PopupMenu.PopupMenuItem('Close');
        this._menuItemCloseWindow.connect('activate', Lang.bind(this, this._onMenuItemCloseWindowActivate));
        this.addMenuItem(this._menuItemCloseWindow);
        this._menuItemMinimizeWindow = new PopupMenu.PopupMenuItem('Minimize');
        this._menuItemMinimizeWindow.connect('activate', Lang.bind(this, this._onMenuItemMinimizeWindowActivate));
        this.addMenuItem(this._menuItemMinimizeWindow);
        this._menuItemMaximizeWindow = new PopupMenu.PopupMenuItem('Maximize');
        this._menuItemMaximizeWindow.connect('activate', Lang.bind(this, this._onMenuItemMaximizeWindowActivate));
        this.addMenuItem(this._menuItemMaximizeWindow)
    },

    _onMenuItemMaximizeWindowActivate: function() {
        //causes gnome-shell 3.0.2 to crash
        //this.metaWindow.maximize(true);
    },

    _onMenuItemMinimizeWindowActivate: function() {
        this.metaWindow.minimize(global.get_current_time());
    },

    _onMenuItemCloseWindowActivate: function() {
        this.app.request_quit();
    },

    open: function(animate) {
        // Dynamically generate the thumbnail when we open the menu since
        // when extensions first load, the thumbnail is unavailable
        this.generateThumbnail();
        RightClickPopupMenu.prototype.open.call(this, animate);
    },

    generateThumbnail: function() {
        // If we already made a thumbnail, we don't need to make it again
        if (this.thumbnail) {
            return;
        }

        // Get a pretty thumbnail of our app
        let mutterWindow = this.metaWindow.get_compositor_private();
        if (mutterWindow) {
            let windowTexture = mutterWindow.get_texture();
            let [width, height] = windowTexture.get_size();
            let scale = Math.min(1.0, THUMBNAIL_DEFAULT_SIZE / width, THUMBNAIL_DEFAULT_SIZE / height);
            this.thumbnail = new Clutter.Clone ({ source: windowTexture,
                                                  reactive: true,
                                                  width: width * scale,
                                                  height: height * scale });

            this.thumnailMenuItem = new PopupMenuThumbnailItem(this.thumbnail);
            this.addMenuItem(this.thumnailMenuItem);
            this.thumnailMenuItem.connect('activate', Lang.bind(this, function() {
                this.metaWindow.activate(global.get_current_time());
            }));
        }
    }
};

function PopupMenuThumbnailItem() {
    this._init.apply(this, arguments);
}

PopupMenuThumbnailItem.prototype = {
    __proto__: PopupMenu.PopupBaseMenuItem.prototype,

    _init: function (image, params) {
        PopupMenu.PopupBaseMenuItem.prototype._init.call(this, params);

        this.image = image;
        this.addActor(this.image);
    }
};
