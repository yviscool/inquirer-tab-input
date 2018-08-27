'use strict';
/**
 * `input` type prompt
 */

var chalk = require('chalk');
var Base = require('inquirer/lib/prompts/base');
var observe = require('inquirer/lib/utils/events');
var Choices = require('inquirer/lib/objects/choices');
var Paginator = require('inquirer/lib/utils/paginator');
var util = require('inquirer/lib/utils/readline');

var stringWidth = require('string-width');
var ansiEscapes =  require('ansi-escapes');

var { map, takeUntil, share, filter } = require('rxjs/operators');



var _ = require('lodash');

class InputPrompt extends Base {


  constructor(questions, rl, answers) {
    super(questions, rl, answers);

    if (!this.opt.source) {
      this.throwParamError('source');
    }

    this.opt = _.defaults(_.clone(this.opt), {
      bgcolor: chalk.bgBlue,
      // pointerBgColor: chalk.bgred,

    })

    this.pointer =  0;
    this.firstRender = true;

    this.choices = new Choices([], this.answer);
    this.paginator = new Paginator(this.screen);


    // screen render
    this.height = 0;
    // 当前光标位置
    this.cursorPosition = 0;

    this.questionLength;
    this.maxChoiceLength;
  }

  _run(cb) {
    this.done = cb;

    var events = observe(this.rl);
    var submit = events.line.pipe(map(this.filterInput.bind(this)));

    var validation = this.handleSubmitEvents(submit);
    validation.success.forEach(this.onEnd.bind(this));
    validation.error.forEach(this.onError.bind(this));

    events.keypress
      .pipe(
        filter(({key})=> key.name !== 'tab'),
        share(),
      )
      .pipe(takeUntil(validation.success))
      .forEach(this.onKeypress.bind(this));

    // tab key 
    events.keypress
      .pipe(...this.tabKey())
      .pipe(takeUntil(validation.success))
      .forEach(this.onTabKey.bind(this))

    // Init
    this.render();

    this.firstRender = false;

    return this;
  }

  /**
   * Render the prompt to screen
   * @return {InputPrompt} self
   */

  render(error) {
    var bottomContent = '';
    var appendContent = '';
    var message = this.getQuestion();
    var transformer = this.opt.transformer;
    var isFinal = this.status === 'answered';



    if (isFinal) {
      appendContent = this.answer;
    } else {
      appendContent = this.rl.line;
    }

    if (transformer) {
      message += transformer(appendContent, this.answers, { isFinal });
    } else {
      message += isFinal ? chalk.cyan(appendContent) : appendContent;
    }

    require('fs').writeFileSync('xx.txt', message);

    this.questionLength = stringWidth(message);

    if (!this.firstRender){

      var choicesStr = this.renderChoices(this.choices, this.pointer);

      var indexPosition = this.choices.indexOf(
          this.choices.getChoice(this.pointer)
      );
      // add 
      var realChoiceStr = this.paginator.paginate(choicesStr, indexPosition, this.opt.pageSize);
      var changed = choicesStr !== realChoiceStr;
      if (changed) {
          choicesStr = _.slice(realChoiceStr.split('\n'), 0, -1)
          realChoiceStr = choicesStr.join('\n') + '\n';
      }

      message += '\n' + realChoiceStr;

    }


    if (error) {
      bottomContent = chalk.red('>> ') + error;
    }

    // this.screen.render(message, bottomContent);
    this.screenRender(message, bottomContent);
  }



  renderChoices(choices, pointer) {
    var self = this;
    var output = [];
    var spaceOffset = this.questionLength;
    var space = Array.apply(null, {length: Math.floor(spaceOffset)}).fill(' ').join('');
    var separatorOffset = 0;
    var maxChoiceLength = 0;
    var currentPointer = 0;
    choices.forEach(function(choice, index) {

      // Is a separator
      if (choice.type === 'separator') {

        separatorOffset++;
        output.push(' ' + choice );

        // output = self.opt.bgcolor(output);
        return;

      }

      // Is the choice disabled
      if (choice.disabled) {

        separatorOffset++;
        var message = choice.name + ' (' + (_.isString(choice.disabled) ? choice.disabled : 'Disabled') + ')';
          output.push(
              space + 
              self.opt.bgcolor(' ' + message)
          )

        return;

      }
      var message;
      // Is the current choice is the selected choice
      if (index - separatorOffset === pointer) {
        currentPointer = separatorOffset;
        message = choice.name;
      }

      message = choice.name;
      output.push(
          space + 
          self.opt.bgcolor(' ' + message)
      )

    });

    var maxChoiceLength = _.max(_.map(output, stringWidth));

    this.maxChoiceLength = maxChoiceLength;

    // 为 choice 追加空格，背景，指示背景
    output = _.map(output, (message, index) => {
      var messageLength = stringWidth(message);
      if (messageLength < maxChoiceLength) {
        message = message + 
        self.opt.bgcolor(
          Array.apply(null, {
            length: maxChoiceLength - messageLength
          })
          .fill(' ')
          .join('')
        ) 
      }
      if (index - currentPointer === pointer) {
        return chalk.gray(message + chalk.bgRed(' '))
      }
      return message + chalk.bgWhite(' ')
    })
    output = output.join('\n')
    return output.replace(/\n$/, '');
  }

  executeSource() {
    var self = this;
    var sourcePromise = this.opt.source(this.answers, this.rl.line);

    if (!(sourcePromise instanceof Promise)){
      throw new Error('source function must return a Promise')
    }

    sourcePromise.then(choices => {
      self.choices = new Choices(choices, self.answers);
      self.render();
    })

    return sourcePromise;
  }
  /**
   * When user press `enter` key
   */

  filterInput(input) {
    if (!input) {
      return this.opt.default == null ? '' : this.opt.default;
    }
    return input;
  }

  onEnd(state) {
    this.answer = state.value;
    this.status = 'answered';

    // Re-render prompt
    this.render();

    this.screen.done();
    this.done(state.value);
  }

  onError(state) {
    this.render(state.isValid);
  }


  tabKey() {
    return [
      filter(({ key }) => key.name === 'tab'),
      share(),
    ]
  }

  /**
   * When user press a key
   */

  onKeypress() {
    this.executeSource();
    // this.render();
  }

  onTabKey() {
    var self = this;
    // this.rl.line = this.choices.getChoice(0);
    this.executeSource().then(result =>{
      var len = self.choices.realLength;
      self.pointer = this.pointer < len - 1 ? this.pointer + 1 : 0;
      self.rl.line = self.choices.getChoice(self.pointer).name;
      // var a = this.rl._getCursorPos()
      // require('fs').writeFileSync('xx.txt',`${a.cols} ${a.rows}`);
      self.render()
    })
  }


  screenRender(content, bottomContent) {
    this.clean();
    this.height = content.split('\n').length;

    if (this.firstRender){
      this.rl.output.write(content);
      return;
    }

    // this.height = content.split('\n').length;
    this.rl.output.write(content);
    if (this.maxChoiceLength > this.questionLength){
      this.resetCursor(this.maxChoiceLength - this.questionLength);
    } else if (this.maxChoiceLength < this.questionLength){

    }
  }

  clean(){
    util.clearLine(this.rl, 1);
    this.rl.output.write(ansiEscapes.eraseDown);
  }


  resetCursor(x){
    util.up(this.rl, this.height + 1);
    util.left(this.rl, x + 1)
  }


}





















// require('./rd')

var inquirer = require('inquirer')

var colors = [
  {name: 'red color', value: 'red', short: 'red', disabled: false},
  {name: 'blue color', value: 'blue', short: 'blue', disabled: false},
  {name: 'green color', value: 'green', short: 'green', disabled: false},
  {name: 'yellow color', value: 'yellow', short: 'yellow', disabled: false},
  {name: 'black color', value: {name: 'black'}, short: 'black', disabled: false}
];


inquirer.registerPrompt('input', InputPrompt);

var questions = [
  {
    type: 'input',
    name: 'first_name',
    message: "What's your first name ? ",
    source: () => {
      return new Promise(resolve => {
        resolve(colors);
      }) 
    }
  },
];

inquirer.prompt(questions).then(answers => {
  console.log(JSON.stringify(answers, null, '  '));
});
