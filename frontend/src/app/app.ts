import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { ModalHostComponent } from './shared/modal-host.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ModalHostComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  protected readonly title = signal('frontend');
}
