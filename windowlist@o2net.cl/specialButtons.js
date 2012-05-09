//vim: expandtab shiftwidth=4 tabstop=8 softtabstop=4 encoding=utf-8 textwidth=99
/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

// Some app-buttons that display an icon
// and an label

const Clutter = imports.gi.Clutter;
const Lang = imports.lang;
const Main = imports.ui.main;
const Mainloop = imports.mainloop;
const Panel = imports.ui.panel;
const Params = imports.misc.params;
const PopupMenu = imports.ui.popupMenu;
const Shell = imports.gi.Shell;
const St = imports.gi.St;
const Tweener = imports.ui.tweener;

const BUTTON_BOX_ANIMATION_TIME = .5;
const MAX_BUTTON_WIDTH = 150; // Pixels


// Creates a button with an icon and a label.
// The label text must be set with setText
// @icon: the icon to be displayed
// @textOffsetFactor: a number between 0 and 1.  The label will be positioned at iconWidth*textOffsetFactor
function IconLabelButton() {
    this._init.apply(this, arguments);
}

IconLabelButton.prototype = {
    _init: function(icon, textOffsetFactor) {
        if (icon == null)
            throw 'IconLabelButton icon argument must be non-null';
        this.textOffsetFactor = textOffsetFactor || 0.5;

        this.actor = new St.Bin({ style_class: 'panel-button',
                                  reactive: true,
                                  can_focus: true,
                                  x_fill: true,
                                  y_fill: false,
                                  track_hover: true });
        this.actor._delegate = this;

        // We do a fancy layout with icons and labels, so we'd like to do our own allocation
        // in a Shell.GenericContainer
        this._container = new Shell.GenericContainer({ name: 'iconLabelButton' });
        this._container.connect('get-preferred-width', Lang.bind(this, this._getPreferredWidth));
        this._container.connect('get-preferred-height', Lang.bind(this, this._getPreferredHeight));
        this._container.connect('allocate', Lang.bind(this, this._allocate));
        this.actor.set_child(this._container)

        this._iconBox = new Shell.Slicer({ name: 'appMenuIcon' });
        this._iconBox.connect('style-changed', Lang.bind(this, this._onIconBoxStyleChanged));
        this._iconBox.connect('notify::allocation', Lang.bind(this, this._updateIconBoxClip));
        this._iconBox.set_child(icon);
        this._container.add_actor(this._iconBox);
        this._label = new Panel.TextShadower();
        this._container.add_actor(this._label.actor);
        this._iconBottomClip = 0;
    },

    setText: function(text) {
        this._label.setText(text);
    },

    // ------------------------------------------
    // -- Callbacks for display-related things --
    // ------------------------------------------

    _onIconBoxStyleChanged: function() {
        let node = this._iconBox.get_theme_node();
        this._iconBottomClip = node.get_length('app-icon-bottom-clip');
        this._updateIconBoxClip();
    },

    _updateIconBoxClip: function() {
        let allocation = this._iconBox.allocation;
        if (this._iconBottomClip > 0) {
            this._iconBox.set_clip(0, 0,
                                   allocation.x2 - allocation.x1,
                                   allocation.y2 - allocation.y1 - this._iconBottomClip);
        } else {
            this._iconBox.remove_clip();
        }
    },

    _getPreferredWidth: function(actor, forHeight, alloc) {
        let [iconMinSize, iconNaturalSize] = this._iconBox.get_preferred_width(forHeight);
        let [labelMinSize, labelNaturalSize] = this._label.actor.get_preferred_width(forHeight);
        // The label text is starts in the center of the icon, so we should allocate the space
        // needed for the icon plus the space needed for(label - icon/2)
        alloc.min_size = iconMinSize + Math.max(0, labelMinSize - Math.floor(iconMinSize * this.textOffsetFactor));
        alloc.natural_size = Math.min(iconNaturalSize + Math.max(0, labelNaturalSize - Math.floor(iconNaturalSize * this.textOffsetFactor)), MAX_BUTTON_WIDTH);
    },

    _getPreferredHeight: function(actor, forWidth, alloc) {
        let [iconMinSize, iconNaturalSize] = this._iconBox.get_preferred_height(forWidth);
        let [labelMinSize, labelNaturalSize] = this._label.actor.get_preferred_height(forWidth);
        alloc.min_size = Math.max(iconMinSize, labelMinSize);
        alloc.natural_size = Math.max(iconNaturalSize, labelMinSize);
    },

    _allocate: function(actor, box, flags) {
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
        let direction = Clutter.get_default_text_direction();

        // Set the icon to be left-justified (or right-justified) and centered vertically
        let [iconMinWidth, iconMinHeight, iconNaturalWidth, iconNaturalHeight] = this._iconBox.get_preferred_size();
        [childBox.y1, childBox.y2] = center(allocHeight, iconNaturalHeight);
        if (direction == Clutter.TextDirection.LTR) {
            [childBox.x1, childBox.x2] = [0, Math.min(iconNaturalWidth, allocWidth)];
        } else {
            [childBox.x1, childBox.x2] = [Math.max(0, allocWidth - iconNaturalWidth), allocWidth];
        }
        this._iconBox.allocate(childBox, flags);
//        log('allocateA ' + [childBox.x1<0, childBox.x2<0, childBox.y1, childBox.y2] + ' ' + [childBox.x2-childBox.x1, childBox.y2-childBox.y1])

        // Set the label to start its text in the center (well, at a this.textOffsetFactor*iconWidth offset) of the icon
        let iconWidth = childBox.x2 - childBox.x1;
        [minWidth, minHeight, naturalWidth, naturalHeight] = this._label.actor.get_preferred_size();
        [childBox.y1, childBox.y2] = center(allocHeight, naturalHeight);
        if (direction == Clutter.TextDirection.LTR) {
            childBox.x1 = Math.floor(iconWidth * this.textOffsetFactor);
            childBox.x2 = Math.min(childBox.x1 + naturalWidth, allocWidth, MAX_BUTTON_WIDTH);
        } else {
            childBox.x2 = Math.min(allocWidth - Math.floor(iconWidth * this.textOffsetFactor), MAX_BUTTON_WIDTH);
            childBox.x1 = Math.max(0, childBox.x2 - naturalWidth);
        }
        this._label.actor.allocate(childBox, flags);
//        log('allocateB ' + [childBox.x1<0, childBox.x2<0, childBox.y1, childBox.y2] + ' ' + [childBox.x2-childBox.x1, childBox.y2-childBox.y1])
    },

    show: function(animate, targetWidth) {
        if (!animate) {
            this.actor.show();
            return;
        }

        let width = this.oldWidth || targetWidth;
        if (!width) {
            let [minWidth, naturalWidth] = this.actor.get_preferred_width(-1);
            width = naturalWidth;
        }

        this.actor.width = 3;
        this.actor.show();
        Tweener.addTween(this.actor,
             { width: width,
               time: BUTTON_BOX_ANIMATION_TIME,
               transition: "easeOutQuad"
             });
    },

    hide: function(animate) {
        if (!animate) {
            this.actor.hide();
            return;
        }

        this.oldWidth = this.actor.width;
        Tweener.addTween(this.actor,
             { width: 3,        // FIXME: if this is set to 0, a whole bunch of "Clutter-CRITICAL **: clutter_paint_volume_set_width: assertion `width >= 0.0f' failed" messages appear
               time: BUTTON_BOX_ANIMATION_TIME,
               transition: "easeOutQuad",
               onCompleteScope: this,
               onComplete: function() {
                   this.actor.hide();
               }
             });
    },

    showLabel: function(animate, targetWidth) {
        if (!animate) {
            this._label.actor.show();
            return;
        }

        let width = this.oldLabelWidth || targetWidth;
        if (!width) {
            let [minWidth, naturalWidth] = this._label.actor.get_preferred_width(-1);
            width = naturalWidth;
        }

        this._label.actor.width = 0;
        this._label.actor.show();
        Tweener.addTween(this._label.actor,
             { width: width,
               time: BUTTON_BOX_ANIMATION_TIME,
               transition: "easeOutQuad"
             });
    },

    hideLabel: function(animate) {
        if (!animate) {
            this._label.actor.hide();
            return;
        }

        this.oldLabelWidth = this._label.actor.width;
        Tweener.addTween(this._label.actor,
             { width: 3,        // FIXME: if this is set to 0, a whole bunch of "Clutter-CRITICAL **: clutter_paint_volume_set_width: assertion `width >= 0.0f' failed" messages appear
               time: BUTTON_BOX_ANIMATION_TIME,
               transition: "easeOutQuad",
               onCompleteScope: this,
               onComplete: function() {
                   this._label.actor.hide();
               }
             });
    }
};

// Button with icon and label.  Click events
// need to be attached manually, but automatically
// highlight when a window of app has focus.
function AppButton() {
    this._init.apply(this, arguments);
}

AppButton.prototype = {
    __proto__: IconLabelButton.prototype,

    _init: function(params) {
        params = Params.parse(params, { app: null,
                                        iconSize: 24,
                                        textOffsetFactor: 0.5 });
        this.app = params.app;
        this.icon = this.app.get_faded_icon(1 * params.iconSize);
        IconLabelButton.prototype._init.call(this, this.icon, params.textOffsetFactor);

        let tracker = Shell.WindowTracker.get_default();
        this._trackerSignal = tracker.connect('notify::focus-app', Lang.bind(this, this._onFocusChange));
    },

    _onFocusChange: function() {
        // If any of the windows associated with our app have focus,
        // we should set ourselves to active
        if (this.app.get_windows().some(function(w) { return w.appears_focused; })) {
            this.actor.add_style_pseudo_class('active');
        } else {
            this.actor.remove_style_pseudo_class('active');
        }
    },

    destroy: function() {
        let tracker = Shell.WindowTracker.get_default();
        tracker.disconnect(this._trackerSignal);
        this._container.destroy_all_children();
        this.actor.destroy();
    }
};


// Button tied to a particular metaWindow.  Will raise
// the metaWindow when clicked and the label will change
// when the title changes.
function WindowButton() {
    this._init.apply(this, arguments);
}

WindowButton.prototype = {
    __proto__: IconLabelButton.prototype,

    _init: function(params) {
        params = Params.parse(params, { app: null,
                                        metaWindow: null,
                                        iconSize: 32,
                                        textOffsetFactor: 0.5 });
        this.metaWindow = params.metaWindow;
        this.app = params.app;
        if (this.app == null) {
            let tracker = Shell.WindowTracker.get_default();
            this.app = tracker.get_window_app(metaWindow);
        }
        this.icon = this.app.get_faded_icon(2 * params.iconSize);
        IconLabelButton.prototype._init.call(this, this.icon, params.textOffsetFactor);
        this.signals = [];

        this.actor.connect('button-release-event', Lang.bind(this, this._onButtonRelease));
        // We need to keep track of the signals we add to metaWindow so we can delete them when we are
        // destroyed. Signals we add to any of our actors will get destroyed in the destroy() function automatically
        this.signals.push(this.metaWindow.connect('notify::appears-focused', Lang.bind(this, this._onFocusChange)));
        this.signals.push(this.metaWindow.connect('notify::title', Lang.bind(this, this._onTitleChange)));
        this.signals.push(this.metaWindow.connect('notify::urgent', Lang.bind(this, this._onAttentionRequest)));
        this.signals.push(this.metaWindow.connect('notify::demands-attention', Lang.bind(this, this._onAttentionRequest)));

        this._onTitleChange();
        this._onFocusChange();
    },

    destroy: function() {
        this.signals.forEach(Lang.bind(this, function(s) {
            this.metaWindow.disconnect(s);
        }));
        this._container.destroy_all_children();
        this.actor.destroy();
    },

    _onAttentionRequest: function() {
        if (this.metaWindow.urgent) {
            this.actor.add_style_pseudo_class('urgent');
        } else {
            this.actor.remove_style_pseudo_class('urgent');
        }

        if (this.metaWindow.demands_attention) {
            this.actor.add_style_pseudo_class('demands-attention');
        } else {
            this.actor.remove_style_pseudo_class('demands-attention');
        }
    },

    _onButtonRelease: function(actor, event) {
        if (Shell.get_event_state(event) & Clutter.ModifierType.BUTTON1_MASK) {
            if (this.metaWindow.has_focus()) {
                this.metaWindow.minimize(global.get_current_time());
            } else {
                this.metaWindow.activate(global.get_current_time());
            }
        }
    },

    _onFocusChange: function() {
        let focused = this.metaWindow.appears_focused;
        if (focused) {
            this.actor.add_style_pseudo_class('active');
        } else {
            this.actor.remove_style_pseudo_class('active');
        }
    },

    _onTitleChange: function() {
        let title = this.metaWindow.get_title() || '';
        this.setText(title);
    },
};


// A box that will hold a bunch of buttons
function ButtonBox() {
    this._init.apply(this, arguments);
}

ButtonBox.prototype = {
    _init: function(params) {
        params = Params.parse(params, {});
        this.actor = new St.BoxLayout({ style_class: 'app-window-list-box' });
        //this.actor._delegate = this;
    },

    show: function(animate, targetWidth) {
        if (!animate) {
            this.actor.show();
            return;
        }

        let width = this.oldWidth || targetWidth;
        if (!width) {
            let [minWidth, naturalWidth] = this.actor.get_preferred_width(-1);
            width = naturalWidth;
        }

        this.actor.width = 3;
        this.actor.show();
        Tweener.addTween(this.actor,
             { width: width,
               time: BUTTON_BOX_ANIMATION_TIME,
               transition: "easeOutQuad"
             });
    },

    hide: function(animate) {
        if (!animate) {
            this.actor.hide();
            return;
        }

        this.oldWidth = this.actor.width;
        Tweener.addTween(this.actor,
             { width: 3,        // FIXME: if this is set to 0, a whole bunch of "Clutter-CRITICAL **: clutter_paint_volume_set_width: assertion `width >= 0.0f' failed" messages appear
               time: BUTTON_BOX_ANIMATION_TIME,
               transition: "easeOutQuad",
               onCompleteScope: this,
               onComplete: function() {
                   this.actor.width = 0;
                   this.actor.hide();
               }
             });
    },

    add: function(button) {
        this.actor.add_actor(button.actor);
    },

    remove: function(button) {
        this.actor.remove_actor(button.actor);
    },

    clear: function() {
        this.actor.destroy_all_children();
    },

    destroy: function() {
        this.actor.destroy_all_children();
        this.actor.destroy();
        this.actor = null;
    }
};
