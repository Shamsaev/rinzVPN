// Не открывать консоль рядом с окном в релизной сборке под Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    rinzvpn_lib::run()
}
