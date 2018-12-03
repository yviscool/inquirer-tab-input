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
      bgcolor: chalk.bgCyan.bind(chalk),
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

    // require('fs').writeFileSync('xx.txt', message);

    this.questionLength = stringWidth(message);

    if (!this.firstRender){

      var choicesStr = this.renderChoices(this.choices, this.pointer);

      var indexPosition = this.choices.indexOf(this.choices.getChoice(this.pointer) ); 
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
    var defaultBgColor = self.opt.bgcolor;
    var output = [];
    var questionAppendSpace = " ".repeat(this.questionLength) 
    var separatorOffset = 0;
    var maxChoiceLength = 0;
    // var currentPointer = 0;
    choices.forEach(function(choice, index) {

      var message;
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

        message = choice.name + ' (' + (_.isString(choice.disabled) ? choice.disabled : 'Disabled') + ')';

        output.push(questionAppendSpace + defaultBgColor(' ' + message))

        return;

      }

      // Is the current choice is the selected choice
      if (index - separatorOffset === pointer) {
        // currentPointer = separatorOffset;
        message = chalk.bgRed( ' ' + chalk.black(choice.name) + ' ');
      } else {
        message = defaultBgColor( ' ' +  chalk.white(choice.name) + ' ');
      }

      output.push(questionAppendSpace + message);

    });

    // 查找最长的 choice 方便统一 背景长度
    var maxChoiceLength = _.max(_.map(output, stringWidth));

    this.maxChoiceLength = maxChoiceLength;

    // 为 choice 追加空格  
    output = _.map(output, (message, index) => {
      var messageLength = stringWidth(message);
      // 如果 该 choice 小于 最大的 choice 则追加空格
      if (messageLength < maxChoiceLength) {
        if (index - separatorOffset === pointer) {
          return message + chalk.bgRed(' '.repeat(maxChoiceLength - messageLength )) + chalk.bgYellow(' ');
        }
        message = message + defaultBgColor(' '.repeat(maxChoiceLength - messageLength));
      } else if (messageLength === maxChoiceLength){
        if (index - separatorOffset === pointer){
          return message + chalk.bgYellow(' ');
        }
      }
      // 增加方块 指示
      return message + chalk.bgWhite(' ');
    })
    output = output.join('\n');
    // 替代最后一个 \n 
    return output.replace(/\n$/, '');
  }

  executeSource() {
    var sourcePromise = this.opt.source(this.answers, this.rl.line);

    if (!(sourcePromise instanceof Promise)){
      throw new Error('source function must return a Promise')
    }

    sourcePromise.then(choices => {
      this.choices = new Choices(choices, this.answers);
      this.render();
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
    // this.rl.line = this.choices.getChoice(0);
    this.executeSource().then(result =>{
      var len = this.choices.realLength;
      this.pointer = this.pointer < len - 1 ? this.pointer + 1 : 0;


      // this._insertString(lines[i]);


      this.rl._deleteLineLeft();
      var str = this.rl.line + this.choices.getChoice(this.pointer).name;

      // ctrl + u

      for (var str of str) {
        this.rl._insertString(str); 
      }
      // self.rl.line = self.choices.getChoice(self.pointer).name;
      // var a = this.rl._getCursorPos()
      // require('fs').writeFileSync('xx.txt',`${a.cols} ${a.rows}`);
      this.render();
    })
  }


  screenRender(content, bottomContent) {


    if (this.firstRender){
      this.rl.output.write(content);
      return;
    }



    this.height = content.split('\n').length;

    // this.rl._refreshLine();
    // this.height = content.split('\n').length;
    this.clean();
    this.rl.output.write(content);

    if (this.maxChoiceLength > this.questionLength){
      this.resetCursor(this.maxChoiceLength - this.questionLength, this.height - 1);
    }
     // else if (this.maxChoiceLength < this.questionLength){}
  }

  clean(){
    util.clearLine(this.rl, 1);
    this.rl.output.write(ansiEscapes.eraseDown);
  }


  resetCursor(x, y){
    util.left(this.rl, x + 1 )
    util.up(this.rl, y)
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
