# ggplot2 reference: geom_bar — weighted counts
ggplot(mpg, aes(class)) + geom_bar(aes(weight = displ))
